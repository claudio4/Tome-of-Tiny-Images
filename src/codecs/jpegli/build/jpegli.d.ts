export interface JpegliWasmModule {
  HEAPU8: Uint8Array;
  _malloc(size: number): number;
  _free(ptr: number): void;
  _jpegli_decode_rgba(ptr: number, len: number): number;
  _jpegli_out_ptr(): number;
  _jpegli_out_len(): number;
  _jpegli_out_width(): number;
  _jpegli_out_height(): number;
  _jpegli_out_icc_ptr(): number;
  _jpegli_out_icc_len(): number;
  _jpegli_out_free(): void;
}

export default function createJpegliModule(overrides?: object): Promise<JpegliWasmModule>;
