import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

Object.defineProperty(window.navigator, "clipboard", {
  configurable: true,
  value: { writeText: vi.fn().mockResolvedValue(undefined) },
});
