//
//  IosMediaPermissionBridge.swift
//  App-iOS 相机 / 相册授权预检：not-determined 时弹出系统授权窗。
//  与 StreamPcmRecorderBridge 麦克风授权同一套「UTS 轮询拉取」模式
//  （iOS 桥 Bool 不能用 == true 严格比较，UTS 侧须真值判断）。
//
import AVFoundation
import Foundation
import Photos

public class IosMediaPermissionBridge {
    private let lock = NSLock()
    private var cameraResolvedFlag = false
    private var cameraGrantedFlag = false
    private var photoResolvedFlag = false
    private var photoGrantedFlag = false

    /// 请求相机权限。已确定则立刻回结果；notDetermined 弹系统窗。
    public func requestCameraPermission() {
        let status = AVCaptureDevice.authorizationStatus(for: .video)
        switch status {
        case .authorized:
            setCameraResult(true)
        case .denied, .restricted:
            setCameraResult(false)
        case .notDetermined:
            lock.lock()
            cameraResolvedFlag = false
            lock.unlock()
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                self?.setCameraResult(granted)
            }
        @unknown default:
            setCameraResult(false)
        }
    }

    public func cameraPermissionResolved() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return cameraResolvedFlag
    }

    public func cameraPermissionGranted() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return cameraGrantedFlag
    }

    /// 请求相册读取权限（iOS 14+ readWrite，含有限访问）。已确定则立刻回结果。
    public func requestPhotoLibraryPermission() {
        if #available(iOS 14, *) {
            let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
            switch status {
            case .authorized, .limited:
                setPhotoResult(true)
            case .denied, .restricted:
                setPhotoResult(false)
            case .notDetermined:
                lock.lock()
                photoResolvedFlag = false
                lock.unlock()
                PHPhotoLibrary.requestAuthorization(for: .readWrite) { [weak self] next in
                    self?.setPhotoResult(next == .authorized || next == .limited)
                }
            @unknown default:
                setPhotoResult(false)
            }
            return
        }
        let status = PHPhotoLibrary.authorizationStatus()
        switch status {
        case .authorized:
            setPhotoResult(true)
        case .denied, .restricted:
            setPhotoResult(false)
        case .notDetermined:
            lock.lock()
            photoResolvedFlag = false
            lock.unlock()
            PHPhotoLibrary.requestAuthorization { [weak self] next in
                self?.setPhotoResult(next == .authorized)
            }
        @unknown default:
            setPhotoResult(false)
        }
    }

    public func photoPermissionResolved() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return photoResolvedFlag
    }

    public func photoPermissionGranted() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return photoGrantedFlag
    }

    private func setCameraResult(_ granted: Bool) {
        lock.lock()
        cameraGrantedFlag = granted
        cameraResolvedFlag = true
        lock.unlock()
    }

    private func setPhotoResult(_ granted: Bool) {
        lock.lock()
        photoGrantedFlag = granted
        photoResolvedFlag = true
        lock.unlock()
    }
}
