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

type ExtendedMediaTrackConstraints = MediaTrackConstraints & {
  resizeMode?: string;
};

type ZoomCapability = {
  min?: number;
  max?: number;
};

type NumericCapability = {
  min?: number;
  max?: number;
};

function clampPreferredValue(capability: NumericCapability | undefined, preferred: number, fallback: number) {
  if (!capability?.max) return fallback;
  const min = capability.min ?? fallback;
  return Math.max(min, Math.min(capability.max, preferred));
}

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
      zoom?: ZoomCapability;
      width?: NumericCapability;
      height?: NumericCapability;
      focusMode?: string[];
    };

    const advanced: MediaTrackConstraintSet[] = [];

    const idealWidth = clampPreferredValue(capabilities.width, 1920, 1280);
    const idealHeight = clampPreferredValue(capabilities.height, 1080, 720);

    advanced.push({
      width: idealWidth,
      height: idealHeight,
    } as MediaTrackConstraintSet);

    if (Array.isArray(capabilities.focusMode) && capabilities.focusMode.includes("continuous")) {
      advanced.push({ focusMode: "continuous" } as MediaTrackConstraintSet);
    }

    if (capabilities.zoom) {
      advanced.push({ zoom: capabilities.zoom.min ?? 1 } as MediaTrackConstraintSet);
    }

    await track.applyConstraints({ advanced });

    const settings = track.getSettings();
    console.log("[Camera] Normalized track settings:", {
      width: settings.width,
      height: settings.height,
      focusMode: (settings as MediaTrackSettings & { focusMode?: string }).focusMode,
      zoom: (settings as MediaTrackSettings & { zoom?: number }).zoom,
    });
  } catch (e) {
    console.warn("[Camera] Could not normalize track constraints", e);
  }

  return stream;
}

export async function getRearCameraStream(
  extraConstraints?: MediaTrackConstraints
): Promise<MediaStream> {
  const base: ExtendedMediaTrackConstraints = {
    width: { ideal: 1920, min: 1280 },
    height: { ideal: 1080, min: 720 },
    aspectRatio: { ideal: 16 / 9 },
    frameRate: { ideal: 30, max: 60 },
    resizeMode: "none",
    ...extraConstraints,
  };

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { ...base, facingMode: { exact: "environment" } },
    });
    console.log("[Camera] Got stream via exact environment");
    return normalizeCameraTrack(stream);
  } catch (e) {
    console.warn("[Camera] exact environment failed, trying enumerate", e);
  }

  try {
    const rearDevice = (await navigator.mediaDevices.enumerateDevices())
      .filter((d) => d.kind === "videoinput")
      .map((device) => ({ device, score: scoreRearCamera(device) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)[0]?.device;

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

  console.log("[Camera] Final fallback: ideal environment");
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { ...base, facingMode: { ideal: "environment" } },
  });
  return normalizeCameraTrack(stream);
}
