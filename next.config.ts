import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // onnxruntime-node loads a native .node binary, so it must never be bundled.
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node"],
};

export default nextConfig;
