// Decodes JPEGs to 8-bit RGBA with jpegli (higher precision than libjpeg-turbo,
// which browsers use). Same calling convention as wasm/jxl/wrapper.c: results
// live in global buffers read via jpegli_out_*. Pixels are returned as stored
// (EXIF orientation is not applied) and in the file's own color space; its ICC
// profile, if any, is available via jpegli_out_icc_*.

#include <setjmp.h>
#include <stdint.h>
#include <stdlib.h>

#include <emscripten/emscripten.h>

#include "lib/jpegli/decode.h"

// Returned when the JPEG is valid but can't be represented as RGB + ICC here
// (CMYK, or grayscale with a gray profile); callers fall back to another decoder.
#define JPEGLI_UNSUPPORTED (-2)

static uint8_t* g_out = nullptr;
static size_t g_out_len = 0;
static uint32_t g_width = 0;
static uint32_t g_height = 0;
static uint8_t* g_icc = nullptr;
static unsigned int g_icc_len = 0;

static void reset_output() {
  free(g_out);
  free(g_icc);
  g_out = nullptr;
  g_out_len = 0;
  g_width = 0;
  g_height = 0;
  g_icc = nullptr;
  g_icc_len = 0;
}

struct ErrorManager {
  jpeg_error_mgr pub;
  jmp_buf jump;
};

static void on_error(j_common_ptr cinfo) {
  longjmp(reinterpret_cast<ErrorManager*>(cinfo->err)->jump, 1);
}

static void on_message(j_common_ptr, int) {}

extern "C" {

EMSCRIPTEN_KEEPALIVE uint8_t* jpegli_out_ptr() { return g_out; }
EMSCRIPTEN_KEEPALIVE size_t jpegli_out_len() { return g_out_len; }
EMSCRIPTEN_KEEPALIVE uint32_t jpegli_out_width() { return g_width; }
EMSCRIPTEN_KEEPALIVE uint32_t jpegli_out_height() { return g_height; }
EMSCRIPTEN_KEEPALIVE uint8_t* jpegli_out_icc_ptr() { return g_icc; }
EMSCRIPTEN_KEEPALIVE size_t jpegli_out_icc_len() { return g_icc_len; }
EMSCRIPTEN_KEEPALIVE void jpegli_out_free() { reset_output(); }

// Returns 0 on success, JPEGLI_UNSUPPORTED or -1 on error.
EMSCRIPTEN_KEEPALIVE int jpegli_decode_rgba(const uint8_t* data, size_t len) {
  reset_output();
  jpeg_decompress_struct cinfo;
  ErrorManager err;
  cinfo.err = jpegli_std_error(&err.pub);
  err.pub.error_exit = on_error;
  err.pub.emit_message = on_message;
  if (setjmp(err.jump)) {
    jpegli_destroy_decompress(&cinfo);
    reset_output();
    return -1;
  }
  jpegli_create_decompress(&cinfo);
  jpegli_mem_src(&cinfo, data, len);
  jpegli_save_markers(&cinfo, JPEG_APP0 + 2, 0xFFFF);  // ICC profile chunks
  jpegli_read_header(&cinfo, TRUE);
  if (!jpegli_read_icc_profile(&cinfo, &g_icc, &g_icc_len)) {
    g_icc = nullptr;
    g_icc_len = 0;
  }
  bool gray = cinfo.jpeg_color_space == JCS_GRAYSCALE;
  if (cinfo.jpeg_color_space == JCS_CMYK || cinfo.jpeg_color_space == JCS_YCCK ||
      (gray && g_icc_len > 0)) {
    jpegli_destroy_decompress(&cinfo);
    reset_output();
    return JPEGLI_UNSUPPORTED;
  }
  cinfo.out_color_space = JCS_EXT_RGBA;
  jpegli_start_decompress(&cinfo);
  size_t stride = (size_t)cinfo.output_width * 4;
  g_out_len = stride * cinfo.output_height;
  g_out = static_cast<uint8_t*>(malloc(g_out_len));
  if (!g_out) longjmp(err.jump, 1);
  g_width = cinfo.output_width;
  g_height = cinfo.output_height;
  while (cinfo.output_scanline < cinfo.output_height) {
    JSAMPROW row = g_out + cinfo.output_scanline * stride;
    jpegli_read_scanlines(&cinfo, &row, 1);
  }
  jpegli_finish_decompress(&cinfo);
  jpegli_destroy_decompress(&cinfo);
  return 0;
}

}  // extern "C"
