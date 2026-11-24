package main

/*
#include <stdint.h>
#include <opus.h>
*/
import "C"

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/binary"
	"errors"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unsafe"

	"github.com/gorilla/websocket"
	protocol "github.com/livekit/protocol/livekit"
	livekit "github.com/livekit/server-sdk-go/v2"
	"github.com/pion/webrtc/v4"
	"github.com/pion/webrtc/v4/pkg/media"
)

const (
	frameBytes    = 960 * 2
	playbackLimit = 12 * frameBytes
)

type session struct {
	room         atomic.Pointer[livekit.Room]
	reconnecting atomic.Bool
	phase        atomic.Int32
	peerSeen     atomic.Bool
	muted        atomic.Bool
	txFrames     atomic.Uint32
	rxFrames     atomic.Uint32
	txWithSignal atomic.Uint32
	rxWithSignal atomic.Uint32
	stopped      chan struct{}
	stopOnce     sync.Once
	input        chan []byte
	playbackMu   sync.Mutex
	playback     []byte
}

var (
	nextID   atomic.Uint32
	sessions sync.Map
)

var trustSetup sync.Once
var trustReady bool

func prepareTrust() bool {
	trustSetup.Do(func() {
		const location = "/etc/security/certificates"
		roots := x509.NewCertPool()
		entries, err := os.ReadDir(location)
		if err != nil {
			return
		}
		for _, entry := range entries {
			if entry.IsDir() {
				continue
			}
			if pem, err := os.ReadFile(filepath.Join(location, entry.Name())); err == nil &&
				roots.AppendCertsFromPEM(pem) {
				trustReady = true
			}
		}
		if trustReady {
			x509.SetFallbackRoots(roots)
			websocket.DefaultDialer.TLSClientConfig = &tls.Config{MinVersion: tls.VersionTLS12, RootCAs: roots}
		}
	})
	return trustReady
}

func find(id C.uint32_t) *session {
	value, found := sessions.Load(uint32(id))
	if !found {
		return nil
	}
	return value.(*session)
}

func hasSignal(pcm []int16) bool {
	for _, sample := range pcm {
		if sample > 128 || sample < -128 {
			return true
		}
	}
	return false
}

func (s *session) subscribe(track *webrtc.TrackRemote) {
	if track.Kind() != webrtc.RTPCodecTypeAudio ||
		!strings.EqualFold(track.Codec().MimeType, webrtc.MimeTypeOpus) {
		return
	}
	var result C.int
	decoder := C.opus_decoder_create(48000, 1, &result)
	if result != 0 || decoder == nil {
		return
	}
	defer C.opus_decoder_destroy(decoder)
	pcm := make([]int16, 5760)
	packetBytes := make([]byte, 2*len(pcm))
	for {
		packet, _, err := track.ReadRTP()
		if err != nil {
			return
		}
		if len(packet.Payload) == 0 {
			continue
		}
		count := int(C.opus_decode(decoder,
			(*C.uchar)(unsafe.Pointer(&packet.Payload[0])), C.opus_int32(len(packet.Payload)),
			(*C.opus_int16)(unsafe.Pointer(&pcm[0])), C.int(len(pcm)), 0))
		if count <= 0 {
			continue
		}
		for i := 0; i < count; i++ {
			binary.LittleEndian.PutUint16(packetBytes[i*2:], uint16(pcm[i]))
		}
		s.playbackMu.Lock()
		pending := len(s.playback) + count*2
		if pending > playbackLimit {
			dropped := pending - playbackLimit
			copy(s.playback, s.playback[dropped:])
			s.playback = s.playback[:len(s.playback)-dropped]
		}
		s.playback = append(s.playback, packetBytes[:count*2]...)
		s.playbackMu.Unlock()
		s.rxFrames.Add(1)
		if hasSignal(pcm[:count]) {
			s.rxWithSignal.Add(1)
		}
	}
}

func (s *session) run(endpoint, token string) {
	defer func() {
		if s.phase.Load() >= 0 {
			s.phase.Store(-1)
		}
	}()
	if !prepareTrust() {
		s.phase.Store(-7)
		return
	}
	callbacks := livekit.NewRoomCallback()
	callbacks.OnTrackSubscribed = func(track *webrtc.TrackRemote, _ *livekit.RemoteTrackPublication, _ *livekit.RemoteParticipant) {
		go s.subscribe(track)
	}
	callbacks.OnDisconnected = func() {
		s.stopOnce.Do(func() { close(s.stopped) })
	}
	callbacks.OnParticipantConnected = func(_ *livekit.RemoteParticipant) { s.peerSeen.Store(true) }
	callbacks.OnReconnecting = func() { s.reconnecting.Store(true) }
	callbacks.OnReconnected = func() { s.reconnecting.Store(false) }
	room, err := livekit.ConnectToRoomWithToken(endpoint, token, callbacks)
	if err != nil {
		var dnsError *net.DNSError
		var caError x509.UnknownAuthorityError
		switch {
		case errors.As(err, &dnsError):
			s.phase.Store(-4)
		case errors.As(err, &caError):
			s.phase.Store(-3)
		default:
			s.phase.Store(-2)
		}
		return
	}
	defer room.Disconnect()
	s.room.Store(room)
	if len(room.GetRemoteParticipants()) > 0 {
		s.peerSeen.Store(true)
	}
	defer s.room.Store(nil)
	select {
	case <-s.stopped:
		return
	default:
	}
	track, err := livekit.NewLocalSampleTrack(webrtc.RTPCodecCapability{
		MimeType: webrtc.MimeTypeOpus, ClockRate: 48000, Channels: 2,
		SDPFmtpLine: "minptime=10;useinbandfec=1",
	})
	if err != nil {
		return
	}
	defer track.Close()
	if _, err = room.LocalParticipant.PublishTrack(track, &livekit.TrackPublicationOptions{
		Name: "harmony-voice", Source: protocol.TrackSource_MICROPHONE,
	}); err != nil {
		return
	}
	var result C.int
	encoder := C.opus_encoder_create(48000, 1, C.OPUS_APPLICATION_VOIP, &result)
	if result != 0 || encoder == nil {
		return
	}
	defer C.opus_encoder_destroy(encoder)
	s.phase.Store(1)
	pcm := make([]int16, frameBytes/2)
	encoded := make([]byte, 1500)
	buffered := make([]byte, 0, 3*frameBytes)
	for {
		select {
		case <-s.stopped:
			return
		case chunk := <-s.input:
			buffered = append(buffered, chunk...)
			for len(buffered) >= frameBytes {
				if s.muted.Load() {
					clear(pcm)
				} else {
					for i := range pcm {
						pcm[i] = int16(binary.LittleEndian.Uint16(buffered[i*2:]))
					}
				}
				copy(buffered, buffered[frameBytes:])
				buffered = buffered[:len(buffered)-frameBytes]
				written := int(C.opus_encode(encoder, (*C.opus_int16)(unsafe.Pointer(&pcm[0])),
					C.int(len(pcm)), (*C.uchar)(unsafe.Pointer(&encoded[0])), C.opus_int32(len(encoded))))
				if written > 0 && track.WriteSample(media.Sample{
					Data: encoded[:written], Duration: 20 * time.Millisecond,
				}, nil) == nil {
					s.txFrames.Add(1)
					if hasSignal(pcm) {
						s.txWithSignal.Add(1)
					}
				}
			}
		}
	}
}

//export NwStart
func NwStart(endpoint *C.char, token *C.char) C.uint32_t {
	url, jwt := C.GoString(endpoint), C.GoString(token)
	if !strings.HasPrefix(url, "wss://") || jwt == "" {
		return 0
	}
	id := nextID.Add(1)
	s := &session{stopped: make(chan struct{}), input: make(chan []byte, 12),
		playback: make([]byte, 0, playbackLimit)}
	sessions.Store(id, s)
	go s.run(url, jwt)
	return C.uint32_t(id)
}

//export NwStop
func NwStop(id C.uint32_t) {
	if s := find(id); s != nil {
		sessions.Delete(uint32(id))
		s.stopOnce.Do(func() { close(s.stopped) })
	}
}

//export NwStatus
func NwStatus(id C.uint32_t, field C.int) C.int {
	s := find(id)
	if s == nil {
		return -1
	}
	switch int(field) {
	case 2:
		return C.int(s.txFrames.Load())
	case 3:
		return C.int(s.rxFrames.Load())
	case 4:
		return C.int(s.txWithSignal.Load())
	case 5:
		return C.int(s.rxWithSignal.Load())
	case 6:
		room := s.room.Load()
		if room != nil && s.peerSeen.Load() && !s.reconnecting.Load() && len(room.GetRemoteParticipants()) == 0 {
			return 1
		}
		return 0
	default:
		return C.int(s.phase.Load())
	}
}

//export NwMute
func NwMute(id C.uint32_t, muted C.int) {
	if s := find(id); s != nil {
		s.muted.Store(muted != 0)
	}
}

//export NwWrite
func NwWrite(id C.uint32_t, ptr unsafe.Pointer, size C.int) {
	s := find(id)
	if s == nil || s.phase.Load() != 1 || size <= 0 || size > 6*frameBytes || size%2 != 0 {
		return
	}
	chunk := C.GoBytes(ptr, size)
	select {
	case s.input <- chunk:
	default:
	}
}

//export NwRead
func NwRead(id C.uint32_t, ptr unsafe.Pointer, size C.int) C.int {
	if size <= 0 || size > playbackLimit {
		return 0
	}
	dest := unsafe.Slice((*byte)(ptr), int(size))
	clear(dest)
	s := find(id)
	if s == nil {
		return 0
	}
	s.playbackMu.Lock()
	defer s.playbackMu.Unlock()
	n := copy(dest, s.playback)
	copy(s.playback, s.playback[n:])
	s.playback = s.playback[:len(s.playback)-n]
	return C.int(n)
}

func main() {}
