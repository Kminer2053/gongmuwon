import assert from "node:assert/strict";

import { assertSidecarBundleFresh } from "./prepare-offline-release.mjs";

{
  const result = assertSidecarBundleFresh({
    freshness: {
      status: "fresh",
      reason: "ok",
    },
  });

  assert.equal(result.status, "fresh");
}

{
  assert.throws(
    () =>
      assertSidecarBundleFresh({
        freshness: {
          status: "stale",
          reason: "hwpx_writer.py is newer than bundled sidecar; regenerate sidecar bundle.",
        },
      }),
    /stale sidecar bundle/i,
  );
}

console.log("prepare-offline-release checks passed");
