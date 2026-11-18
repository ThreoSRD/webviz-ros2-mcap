// Explicit boundary around the modern TypeScript SDKs. Application contracts
// remain in dataProviders/types.js; Flow 0.110 cannot consume TS declarations.
declare module "@mcap/core" {
  declare export var McapWriter: any;
  declare export var McapIndexedReader: { Initialize: (options: any) => Promise<any> };
}
declare module "@foxglove/rosmsg" {
  declare export function fixupTypes(definitions: any[]): void;
  declare export function parse(source: string, options: { ros2: boolean, skipTypeFixup?: boolean }): any[];
}
declare module "@foxglove/rosmsg2-serialization" {
  declare export class MessageReader {
    constructor(definitions: any[], options?: { timeType: string }): void;
    readMessage(bytes: Uint8Array): any;
  }
}

declare module "@foxglove/wasm-lz4" {
  declare module.exports: any;
}
declare module "@foxglove/wasm-zstd" {
  declare module.exports: any;
}
