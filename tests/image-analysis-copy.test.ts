import assert from "node:assert/strict";
import test from "node:test";
import {
  createImageAnalysisCopy,
  type AnalysisCanvas,
  type ImageAnalysisCopyDependencies,
} from "../src/lib/imageAnalysisCopy";

function blobOf(size: number, type: string): Blob {
  return new Blob([new Uint8Array(size)], { type });
}

function encodedBlobOf(size: number, type: string): Blob {
  return { size, type } as Blob;
}

function fakeDependencies(options: {
  width?: number;
  height?: number;
  encode: AnalysisCanvas["encode"];
  decodeError?: Error;
}) {
  const events: string[] = [];
  let canvasSize: [number, number] | undefined;
  const dependencies: ImageAnalysisCopyDependencies = {
    createObjectURL: () => {
      events.push("create:blob:test");
      return "blob:test";
    },
    revokeObjectURL: (url) => events.push(`revoke:${url}`),
    decodeImage: async () => {
      if (options.decodeError) throw options.decodeError;
      return {
        width: options.width ?? 2000,
        height: options.height ?? 1000,
        source: {} as CanvasImageSource,
      };
    },
    createCanvas: (width, height) => {
      canvasSize = [width, height];
      return {
        draw: () => events.push("draw"),
        encode: options.encode,
      };
    },
  };
  return { dependencies, events, getCanvasSize: () => canvasSize };
}

test("resizes to 1280 and progressively encodes a bounded WebP copy", async () => {
  const qualities: number[] = [];
  const fake = fakeDependencies({
    encode: async (format, quality) => {
      assert.equal(format, "image/webp");
      qualities.push(quality);
      return encodedBlobOf(quality > 0.74 ? 6 * 1024 * 1024 : 1024, format);
    },
  });

  const result = await createImageAnalysisCopy(blobOf(100, "image/png"), {
    dependencies: fake.dependencies,
  });

  assert.deepEqual(fake.getCanvasSize(), [1280, 640]);
  assert.deepEqual(qualities, [0.82, 0.74]);
  assert.equal(result.type, "image/webp");
  assert.equal(result.size, 1024);
  assert.deepEqual(fake.events, ["create:blob:test", "draw", "revoke:blob:test"]);
});

test("falls back to JPEG and reports a clear error when no encoding fits", async () => {
  const formats: string[] = [];
  const fallback = fakeDependencies({
    encode: async (format) => {
      formats.push(format);
      if (format === "image/webp") return null;
      return encodedBlobOf(2048, "image/jpeg");
    },
  });
  const jpeg = await createImageAnalysisCopy(blobOf(100, "image/png"), {
    dependencies: fallback.dependencies,
  });
  assert.equal(jpeg.type, "image/jpeg");
  assert.deepEqual(formats, ["image/webp", "image/jpeg"]);
  assert.equal(fallback.events.at(-1), "revoke:blob:test");

  const oversized = fakeDependencies({
    encode: async (format) => encodedBlobOf(5 * 1024 * 1024 + 1, format),
  });
  await assert.rejects(
    () => createImageAnalysisCopy(blobOf(100, "image/png"), { dependencies: oversized.dependencies }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "size_limit_exceeded" &&
      /超过 5 MiB/.test(error.message),
  );
  assert.equal(oversized.events.at(-1), "revoke:blob:test");
});

test("revokes the source URL when decoding fails", async () => {
  const fake = fakeDependencies({
    decodeError: new Error("broken image"),
    encode: async () => null,
  });

  await assert.rejects(
    () => createImageAnalysisCopy(blobOf(100, "image/png"), { dependencies: fake.dependencies }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "decode_failed",
  );
  assert.deepEqual(fake.events, ["create:blob:test", "revoke:blob:test"]);
});
