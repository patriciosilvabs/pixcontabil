/**
 * Robust rear-camera selection utility.
 *
 * Strategy:
 * 1. Try exact "environment" facingMode
 * 2. If that fails, enumerate devices and pick rear camera by label
 * 3. Normalize the active track to avoid digital zoom on mobile
 * 4. Final fallback: ideal "environment"
 */

const REAR_CAMERA_KEYWORDS = ["back", "rear", "traseira", "environment", "arrière", "rück"];
const PREFERRED_REAR_CAMERA_KEYWORDS = ["wide", "1x", "main", "principal"];
const DEPRIORITIZED_REAR_CAMERA_KEYWORDS = ["tele", "macro", "ultra", "depth"];

function scoreRearCamera(device: MediaDeviceInfo): number {
  const label = device.label.toLowerCase();
  let score = 0;

  if (REAR_CAMERA_KEYWORDS.some((kw) => label.includes(kw))) score += 10;
  if (PREFERRED_REAR_CAMERA_KEYWORDS.some((kw) => label.includes(kw))) score += 5;
  if (DEPRIORITIZED_REAR_CAMERA_KEYWORDS.some((kw) => label.includes(kw))) score -= 5;

  return score;
}

async function normalizeCameraTrack(stream: MediaStream): Promise<MediaStream> {
  const [track] = stream.getVideoTracks();
  if (!track?.getCapabilities || !track.applyConstraints) return stream;

  try {
    const capabilities = track.getCapabilities() as MediaTrackCapabilities & {
      zoom?: { min?: number; max?: number };
    };

    if (capabilities.zoom) {
      await track.applyConstraints({
        advanced: [{ zoom: capabilities.zoom.min ?? 1 }],
      });
      console.log("[Camera] Zoom reset to minimum supported value");
    }
  } catch (e) {
    console.warn("[Camera] Could not normalize track constraints", e);
  }

  return stream;
}

export async function getRearCameraStream(
  extraConstraints?: MediaTrackConstraints
): Promise<MediaStream> {
  const base: MediaTrackConstraints = {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    aspectRatio: { ideal: 16 / 9 },
    resizeMode: "none",
    ...extraConstraints,
  };

  // Attempt 1: exact environment
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { ...base, facingMode: { exact: "environment" } },
    });
    console.log("[Camera] Got stream via exact environment");
    return normalizeCameraTrack(stream);
  } catch (e) {
    console.warn("[Camera] exact environment failed, trying enumerate", e);
  }

  // Attempt 2: enumerate devices and find best rear camera by label
  try {
    const rearDevice = navigator.mediaDevices
      ? (await navigator.mediaDevices.enumerateDevices())
          .filter((d) => d.kind === "videoinput")
          .map((device) => ({ device, score: scoreRearCamera(device) }))
          .filter(({ score }) => score > 0)
          .sort((a, b) => b.score - a.score)[0]?.device
      : undefined;

    if (rearDevice) {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { ...base, deviceId: { exact: rearDevice.deviceId } },
      });
      console.log("[Camera] Got stream via deviceId:", rearDevice.label);
      return normalizeCameraTrack(stream);
    }
  } catch (e) {
    console.warn("[Camera] enumerate fallback failed", e);
  }

  // Attempt 3: ideal environment (original behavior)
  console.log("[Camera] Final fallback: ideal environment");
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { ...base, facingMode: { ideal: "environment" } },
  });
  return normalizeCameraTrack(stream);
}
