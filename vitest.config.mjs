import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.mjs"],
    environment: "node",
    setupFiles: ["./test/setup.mjs"],
    coverage: {
      provider: "v8",
      include: ["src/lib/**", "src/tools/**"],
      reporter: ["text", "text-summary"],
    },
  },
});
