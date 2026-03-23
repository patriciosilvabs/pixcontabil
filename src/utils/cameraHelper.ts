/**
 * Robust rear-camera selection utility.
 * 
 * Strategy:
 * 1. Try exact "environment" facingMode
 * 2. If that fails, enumerate devices and pick rear camera by label
 * 3. Final fallback: ideal "environment"
 */

const REAR_CAMERA_KEYWORDS = ["back", "rear", "traseira", "environment", "arrière", "rück"];

export async function getRearCameraStream(
  extraConstraints?: MediaTrackConstraints
): Promise<MediaStream> {
  const base: MediaTrackConstraints = {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    // @ts-ignore – vendor constraints to prevent digital zoom
    zoom: 1.0,
    resizeMode: "none",
    ...extraConstraints,
  };

  // Attempt 1: exact environment
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { ...base, facingMode: { exact: "environment" } },
    });
    console.log("[Camera] Got stream via exact environment");
    return stream;
  } catch (e) {
    console.warn("[Camera] exact environment failed, trying enumerate", e);
  }

  // Attempt 2: enumerate devices and find rear camera by label
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter((d) => d.kind === "videoinput");
    const rearDevice = videoDevices.find((d) =>
      REAR_CAMERA_KEYWORDS.some((kw) => d.label.toLowerCase().includes(kw))
    );

    if (rearDevice) {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { ...base, deviceId: { exact: rearDevice.deviceId } },
      });
      console.log("[Camera] Got stream via deviceId:", rearDevice.label);
      return stream;
    }
  } catch (e) {
    console.warn("[Camera] enumerate fallback failed", e);
  }

  // Attempt 3: ideal environment (original behavior)
  console.log("[Camera] Final fallback: ideal environment");
  return navigator.mediaDevices.getUserMedia({
    video: { ...base, facingMode: { ideal: "environment" } },
  });
}
