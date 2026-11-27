#include <napi/native_api.h>
#include <stdbool.h>
#include <stdint.h>

extern uint32_t NwStart(char *endpoint, char *token);
extern void NwStop(uint32_t handle);
extern int NwStatus(uint32_t handle, int field);
extern void NwMute(uint32_t handle, int muted);
extern void NwWrite(uint32_t handle, void *bytes, int size);
extern int NwRead(uint32_t handle, void *bytes, int size);

static napi_value integer(napi_env env, int value) {
    napi_value result;
    napi_create_int32(env, value, &result);
    return result;
}

static napi_value start(napi_env env, napi_callback_info info) {
    napi_value args[2];
    size_t argc = 2, length;
    char endpoint[2048], token[16384];
    napi_get_cb_info(env, info, &argc, args, NULL, NULL);
    if (argc != 2 ||
        napi_get_value_string_utf8(env, args[0], NULL, 0, &length) != napi_ok || length >= sizeof(endpoint) ||
        napi_get_value_string_utf8(env, args[0], endpoint, sizeof(endpoint), &length) != napi_ok ||
        napi_get_value_string_utf8(env, args[1], NULL, 0, &length) != napi_ok || length >= sizeof(token) ||
        napi_get_value_string_utf8(env, args[1], token, sizeof(token), &length) != napi_ok) {
        return integer(env, 0);
    }
    return integer(env, NwStart(endpoint, token));
}

static napi_value stop(napi_env env, napi_callback_info info) {
    napi_value arg;
    size_t argc = 1;
    uint32_t handle;
    napi_get_cb_info(env, info, &argc, &arg, NULL, NULL);
    if (argc == 1 && napi_get_value_uint32(env, arg, &handle) == napi_ok) NwStop(handle);
    return integer(env, 0);
}

static napi_value status(napi_env env, napi_callback_info info) {
    napi_value args[2];
    size_t argc = 2;
    uint32_t handle;
    int32_t field;
    napi_get_cb_info(env, info, &argc, args, NULL, NULL);
    if (argc != 2 || napi_get_value_uint32(env, args[0], &handle) != napi_ok ||
        napi_get_value_int32(env, args[1], &field) != napi_ok) return integer(env, -1);
    return integer(env, NwStatus(handle, field));
}

static napi_value mute(napi_env env, napi_callback_info info) {
    napi_value args[2];
    size_t argc = 2;
    uint32_t handle;
    bool muted;
    napi_get_cb_info(env, info, &argc, args, NULL, NULL);
    if (argc == 2 && napi_get_value_uint32(env, args[0], &handle) == napi_ok &&
        napi_get_value_bool(env, args[1], &muted) == napi_ok) NwMute(handle, muted);
    return integer(env, 0);
}

static napi_value audioBuffer(napi_env env, napi_callback_info info, bool read) {
    napi_value args[2];
    size_t argc = 2, length;
    uint32_t handle;
    void *bytes;
    napi_get_cb_info(env, info, &argc, args, NULL, NULL);
    if (argc != 2 || napi_get_value_uint32(env, args[0], &handle) != napi_ok ||
        napi_get_arraybuffer_info(env, args[1], &bytes, &length) != napi_ok || length > 23040 ||
        !bytes || length == 0) return integer(env, 0);
    if (read) return integer(env, NwRead(handle, bytes, (int) length));
    NwWrite(handle, bytes, (int) length);
    return integer(env, 0);
}

static napi_value readPcm(napi_env env, napi_callback_info info) { return audioBuffer(env, info, true); }
static napi_value writePcm(napi_env env, napi_callback_info info) { return audioBuffer(env, info, false); }

static napi_value initialize(napi_env env, napi_value exports) {
    napi_property_descriptor functions[] = {
        { "start", NULL, start, NULL, NULL, NULL, napi_default, NULL },
        { "stop", NULL, stop, NULL, NULL, NULL, napi_default, NULL },
        { "status", NULL, status, NULL, NULL, NULL, napi_default, NULL },
        { "mute", NULL, mute, NULL, NULL, NULL, napi_default, NULL },
        { "readPcm", NULL, readPcm, NULL, NULL, NULL, napi_default, NULL },
        { "writePcm", NULL, writePcm, NULL, NULL, NULL, napi_default, NULL },
    };
    napi_define_properties(env, exports, sizeof(functions) / sizeof(functions[0]), functions);
    return exports;
}

static napi_module module = {
    .nm_version = 1,
    .nm_register_func = initialize,
    .nm_modname = "nuwax_harmony_rtc",
};

__attribute__((constructor)) static void registerModule(void) {
    napi_module_register(&module);
}
