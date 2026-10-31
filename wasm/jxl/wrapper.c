// Thin C API over libjxl for the browser. Each call stores its result in a
// single global buffer (the module runs in one worker, one job at a time);
// JS reads it via jxl_out_ptr/jxl_out_len and must copy it before the next call.

#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include <emscripten/emscripten.h>
#include <jxl/cms.h>
#include <jxl/decode.h>
#include <jxl/encode.h>

#include "skcms.h"

// Images above this size are always encoded with streaming input.
#define STREAMING_MIN_PIXELS (16u * 1000 * 1000)
// ICC profiles larger than this (e.g. LUT-based v4 profiles, tens of KB) are
// not embedded: the pixels are converted to sRGB instead. Smaller ones cost a
// few hundred bytes, and libjxl stores common ones (sRGB, Adobe RGB) as a tag.
#define ICC_EMBED_MAX 8192

static uint8_t* g_out = NULL;
static size_t g_out_len = 0;
static uint32_t g_width = 0;
static uint32_t g_height = 0;

static void reset_output(void) {
  free(g_out);
  g_out = NULL;
  g_out_len = 0;
  g_width = 0;
  g_height = 0;
}

EMSCRIPTEN_KEEPALIVE uint8_t* jxl_out_ptr(void) { return g_out; }
EMSCRIPTEN_KEEPALIVE size_t jxl_out_len(void) { return g_out_len; }
EMSCRIPTEN_KEEPALIVE uint32_t jxl_out_width(void) { return g_width; }
EMSCRIPTEN_KEEPALIVE uint32_t jxl_out_height(void) { return g_height; }
EMSCRIPTEN_KEEPALIVE void jxl_out_free(void) { reset_output(); }

// Drains the encoder into g_out. Returns 0 on success.
static int drain_encoder(JxlEncoder* enc) {
  size_t cap = 64 * 1024;
  uint8_t* buf = malloc(cap);
  if (!buf) return -1;
  uint8_t* next = buf;
  size_t avail = cap;
  JxlEncoderStatus st;
  while ((st = JxlEncoderProcessOutput(enc, &next, &avail)) ==
         JXL_ENC_NEED_MORE_OUTPUT) {
    size_t used = next - buf;
    cap *= 2;
    uint8_t* grown = realloc(buf, cap);
    if (!grown) {
      free(buf);
      return -1;
    }
    buf = grown;
    next = buf + used;
    avail = cap - used;
  }
  if (st != JXL_ENC_SUCCESS) {
    free(buf);
    return -1;
  }
  g_out = buf;
  g_out_len = next - buf;
  return 0;
}

// Lossless JPEG -> JXL transcode. The original JPEG can be reconstructed
// bit-exactly from the output (see jxl_reconstruct_jpeg).
EMSCRIPTEN_KEEPALIVE int jxl_transcode_jpeg(const uint8_t* jpeg, size_t len,
                                            int effort) {
  reset_output();
  JxlEncoder* enc = JxlEncoderCreate(NULL);
  if (!enc) return -1;
  int rc = -1;
  JxlEncoderFrameSettings* fs = JxlEncoderFrameSettingsCreate(enc, NULL);
  if (JxlEncoderUseContainer(enc, JXL_TRUE) != JXL_ENC_SUCCESS) goto done;
  if (JxlEncoderStoreJPEGMetadata(enc, JXL_TRUE) != JXL_ENC_SUCCESS) goto done;
  if (JxlEncoderFrameSettingsSetOption(fs, JXL_ENC_FRAME_SETTING_EFFORT,
                                       effort) != JXL_ENC_SUCCESS)
    goto done;
  if (JxlEncoderAddJPEGFrame(fs, jpeg, len) != JXL_ENC_SUCCESS) goto done;
  JxlEncoderCloseInput(enc);
  rc = drain_encoder(enc);
done:
  JxlEncoderDestroy(enc);
  return rc;
}

// Converts RGBA pixels from `profile` to sRGB in place. Returns 0 on success.
static int convert_to_srgb(uint8_t* rgba, size_t pixels,
                           const skcms_ICCProfile* profile) {
  return skcms_Transform(rgba, skcms_PixelFormat_RGBA_8888,
                         skcms_AlphaFormat_Unpremul, profile, rgba,
                         skcms_PixelFormat_RGBA_8888,
                         skcms_AlphaFormat_Unpremul, skcms_sRGB_profile(),
                         pixels)
             ? 0
             : -1;
}

// Encodes 8-bit RGBA pixels. They are in the color space of `icc` (sRGB when
// icc_len is 0 or the profile is unusable) and stored unrotated: `orientation`
// (EXIF values 1-8) goes into the header and decoders apply it. When has_alpha
// is 0 the buffer is compacted to RGB in place, so callers must not reuse it.
EMSCRIPTEN_KEEPALIVE int jxl_encode_rgba(uint8_t* rgba, uint32_t width,
                                         uint32_t height, int has_alpha,
                                         float distance, int effort,
                                         int lossless, const uint8_t* icc,
                                         size_t icc_len, int orientation) {
  reset_output();
  size_t pixels = (size_t)width * height;
  uint32_t channels = has_alpha ? 4 : 3;
  if (icc_len > 0) {
    // Like browsers, treat a profile that doesn't parse (or isn't RGB) as sRGB.
    skcms_ICCProfile profile;
    if (!skcms_Parse(icc, icc_len, &profile) ||
        profile.data_color_space != skcms_Signature_RGB) {
      icc_len = 0;
    } else if (icc_len > ICC_EMBED_MAX) {
      if (convert_to_srgb(rgba, pixels, &profile) != 0) return -1;
      icc_len = 0;
    }
  }
  if (!has_alpha) {
    for (size_t i = 0; i < pixels; i++) {
      rgba[i * 3 + 0] = rgba[i * 4 + 0];
      rgba[i * 3 + 1] = rgba[i * 4 + 1];
      rgba[i * 3 + 2] = rgba[i * 4 + 2];
    }
  }

  JxlEncoder* enc = JxlEncoderCreate(NULL);
  if (!enc) return -1;
  int rc = -1;

  JxlBasicInfo info;
  JxlEncoderInitBasicInfo(&info);
  info.xsize = width;
  info.ysize = height;
  info.bits_per_sample = 8;
  info.num_color_channels = 3;
  info.alpha_bits = has_alpha ? 8 : 0;
  info.num_extra_channels = has_alpha ? 1 : 0;
  // Lossless must keep the original color space; lossy uses XYB internally.
  info.uses_original_profile = lossless ? JXL_TRUE : JXL_FALSE;
  if (orientation >= 1 && orientation <= 8) info.orientation = orientation;
  if (JxlEncoderSetBasicInfo(enc, &info) != JXL_ENC_SUCCESS) goto done;

  if (icc_len > 0) {
    if (JxlEncoderSetICCProfile(enc, icc, icc_len) != JXL_ENC_SUCCESS) goto done;
  } else {
    JxlColorEncoding color;
    JxlColorEncodingSetToSRGB(&color, JXL_FALSE);
    if (JxlEncoderSetColorEncoding(enc, &color) != JXL_ENC_SUCCESS) goto done;
  }

  JxlEncoderFrameSettings* fs = JxlEncoderFrameSettingsCreate(enc, NULL);
  if (JxlEncoderFrameSettingsSetOption(fs, JXL_ENC_FRAME_SETTING_EFFORT,
                                       effort) != JXL_ENC_SUCCESS)
    goto done;
  // By default libjxl only streams (encodes group by group) for some
  // effort/distance combinations; otherwise it holds full-image float planes,
  // which overflows the 4 GB wasm heap for large maps (~40+ MP). Force
  // streaming input for big images.
  if (pixels > STREAMING_MIN_PIXELS &&
      JxlEncoderFrameSettingsSetOption(fs, JXL_ENC_FRAME_SETTING_BUFFERING,
                                       2) != JXL_ENC_SUCCESS)
    goto done;
  if (lossless) {
    if (JxlEncoderSetFrameLossless(fs, JXL_TRUE) != JXL_ENC_SUCCESS) goto done;
  } else {
    if (JxlEncoderSetFrameDistance(fs, distance) != JXL_ENC_SUCCESS) goto done;
  }

  JxlPixelFormat format = {channels, JXL_TYPE_UINT8, JXL_NATIVE_ENDIAN, 0};
  if (JxlEncoderAddImageFrame(fs, &format, rgba, pixels * channels) !=
      JXL_ENC_SUCCESS)
    goto done;
  JxlEncoderCloseInput(enc);
  rc = drain_encoder(enc);
done:
  JxlEncoderDestroy(enc);
  return rc;
}

// Decodes a JXL file to 8-bit sRGB RGBA (for previews; canvases are sRGB).
// Orientation is applied, so width/height are the displayed dimensions.
EMSCRIPTEN_KEEPALIVE int jxl_decode_rgba(const uint8_t* data, size_t len) {
  reset_output();
  JxlDecoder* dec = JxlDecoderCreate(NULL);
  if (!dec) return -1;
  int rc = -1;
  int gray = 0;
  JxlPixelFormat format = {4, JXL_TYPE_UINT8, JXL_NATIVE_ENDIAN, 0};
  // Without a CMS, files with an ICC profile would come out in linear sRGB.
  if (JxlDecoderSetCms(dec, *JxlGetDefaultCms()) != JXL_DEC_SUCCESS) goto done;
  if (JxlDecoderSubscribeEvents(dec, JXL_DEC_BASIC_INFO | JXL_DEC_COLOR_ENCODING |
                                         JXL_DEC_FULL_IMAGE) != JXL_DEC_SUCCESS)
    goto done;
  JxlDecoderSetInput(dec, data, len);
  JxlDecoderCloseInput(dec);
  for (;;) {
    JxlDecoderStatus st = JxlDecoderProcessInput(dec);
    if (st == JXL_DEC_BASIC_INFO) {
      JxlBasicInfo info;
      if (JxlDecoderGetBasicInfo(dec, &info) != JXL_DEC_SUCCESS) goto done;
      g_width = info.xsize;
      g_height = info.ysize;
      gray = info.num_color_channels == 1;
    } else if (st == JXL_DEC_COLOR_ENCODING) {
      JxlColorEncoding srgb;
      JxlColorEncodingSetToSRGB(&srgb, gray ? JXL_TRUE : JXL_FALSE);
      if (JxlDecoderSetOutputColorProfile(dec, &srgb, NULL, 0) != JXL_DEC_SUCCESS)
        goto done;
    } else if (st == JXL_DEC_NEED_IMAGE_OUT_BUFFER) {
      size_t size;
      if (JxlDecoderImageOutBufferSize(dec, &format, &size) != JXL_DEC_SUCCESS)
        goto done;
      g_out = malloc(size);
      if (!g_out) goto done;
      g_out_len = size;
      if (JxlDecoderSetImageOutBuffer(dec, &format, g_out, size) !=
          JXL_DEC_SUCCESS)
        goto done;
    } else if (st == JXL_DEC_FULL_IMAGE) {
      continue;
    } else if (st == JXL_DEC_SUCCESS) {
      rc = g_out ? 0 : -1;
      break;
    } else {
      goto done;
    }
  }
done:
  JxlDecoderDestroy(dec);
  if (rc != 0) reset_output();
  return rc;
}

// Reconstructs the original JPEG bytes from a transcoded JXL.
EMSCRIPTEN_KEEPALIVE int jxl_reconstruct_jpeg(const uint8_t* data, size_t len) {
  reset_output();
  JxlDecoder* dec = JxlDecoderCreate(NULL);
  if (!dec) return -1;
  int rc = -1;
  size_t cap = len * 2 + 64 * 1024;
  uint8_t* buf = NULL;
  if (JxlDecoderSubscribeEvents(
          dec, JXL_DEC_JPEG_RECONSTRUCTION | JXL_DEC_FULL_IMAGE) !=
      JXL_DEC_SUCCESS)
    goto done;
  JxlDecoderSetInput(dec, data, len);
  JxlDecoderCloseInput(dec);
  int have_jpeg = 0;
  for (;;) {
    JxlDecoderStatus st = JxlDecoderProcessInput(dec);
    if (st == JXL_DEC_JPEG_RECONSTRUCTION) {
      buf = malloc(cap);
      if (!buf) goto done;
      if (JxlDecoderSetJPEGBuffer(dec, buf, cap) != JXL_DEC_SUCCESS) goto done;
      have_jpeg = 1;
    } else if (st == JXL_DEC_JPEG_NEED_MORE_OUTPUT) {
      size_t used = cap - JxlDecoderReleaseJPEGBuffer(dec);
      cap *= 2;
      uint8_t* grown = realloc(buf, cap);
      if (!grown) goto done;
      buf = grown;
      if (JxlDecoderSetJPEGBuffer(dec, buf + used, cap - used) !=
          JXL_DEC_SUCCESS)
        goto done;
    } else if (st == JXL_DEC_FULL_IMAGE) {
      if (!have_jpeg) goto done;  // No reconstruction data in this file.
      g_out_len = cap - JxlDecoderReleaseJPEGBuffer(dec);
      g_out = buf;
      buf = NULL;
      rc = 0;
      break;
    } else {
      goto done;
    }
  }
done:
  free(buf);
  JxlDecoderDestroy(dec);
  return rc;
}
