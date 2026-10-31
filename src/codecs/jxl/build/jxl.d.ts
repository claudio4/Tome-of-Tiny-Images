export interface JxlWasmModule {
  HEAPU8: Uint8Array;
  _malloc(size: number): number;
  _free(ptr: number): void;
  _jxl_transcode_jpeg(ptr: number, len: number, effort: number): number;
  _jxl_encode_rgba(
    ptr: number,
    width: number,
    height: number,
    hasAlpha: number,
    distance: number,
    effort: number,
    lossless: number,
    iccPtr: number,
    iccLen: number,
    orientation: number,
  ): number;
  _jxl_decode_rgba(ptr: number, len: number): number;
  _jxl_reconstruct_jpeg(ptr: number, len: number): number;
  _jxl_out_ptr(): number;
  _jxl_out_len(): number;
  _jxl_out_width(): number;
  _jxl_out_height(): number;
  _jxl_out_free(): void;
}

export default function createJxlModule(overrides?: object): Promise<JxlWasmModule>;
