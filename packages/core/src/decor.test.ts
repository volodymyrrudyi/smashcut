import { describe, expect, it } from "vitest";
import { decor, defineVideo, group, resolveComposition, solid } from "./index";

describe("decor", () => {
  it("builds overlay nodes that keep node props separate from decor options", () => {
    const mark = decor.watermark({ text: "© smashcut", corner: "top-left", alpha: 0.4, opacity: 0.5, at: 1 });
    expect(mark).toMatchObject({ kind: "decor", opacity: 0.5, at: 1 });
    expect(mark.decor).toMatchObject({ type: "watermark", text: "© smashcut", corner: "top-left", alpha: 0.4 });
    expect(decor.grain({ amount: 0.2 }).decor).toMatchObject({ type: "grain", amount: 0.2 });
  });

  it("fills its parent like any node without a duration", () => {
    const comp = resolveComposition(
      defineVideo({ size: [1, 1], fps: 10, layers: [group([solid("red", { duration: 2 }), decor.vignette(), decor.border()])] }),
    );
    expect(comp.layers[0].children.map((c) => c.duration)).toEqual([20, 20, 20]);
  });
});
