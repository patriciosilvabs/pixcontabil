import { useEffect, useRef, useState, useCallback } from "react";
import { BrowserMultiFormatReader, DecodeHintType, BarcodeFormat } from "@zxing/library";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertCircle, Camera, X, Keyboard, ArrowLeft } from "lucide-react";

interface BarcodeScannerProps {
  mode: "qrcode" | "barcode";
  isOpen: boolean;
  onScan: (result: string) => void;
  onClose: () => void;
  onManualInput?: () => void;
}

const qrFormats = [
  Html5QrcodeSupportedFormats.QR_CODE,
];

export function BarcodeScanner({ mode, isOpen, onScan, onClose, onManualInput }: BarcodeScannerProps) {
  // For QR mode we keep html5-qrcode (works fine)
  const html5ScannerRef = useRef<Html5Qrcode | null>(null);
  // For barcode mode we use @zxing/library (much better for 1D barcodes)
  const zxingReaderRef = useRef<BrowserMultiFormatReader | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const containerIdRef = useRef(`scanner-${Math.random().toString(36).slice(2)}`);
  const hasScannedRef = useRef(false);
  const mountedRef = useRef(true);

  const stopScanner = useCallback(async () => {
    // Stop html5-qrcode (QR mode)
    const s = html5ScannerRef.current;
    if (s) {
      html5ScannerRef.current = null;
      try { await s.stop(); } catch {}
      try { s.clear(); } catch {}
    }

    // Stop zxing reader (barcode mode)
    const reader = zxingReaderRef.current;
    if (reader) {
      zxingReaderRef.current = null;
      try { reader.reset(); } catch {}
    }

    // Stop media stream
    const stream = streamRef.current;
    if (stream) {
      streamRef.current = null;
      stream.getTracks().forEach(t => t.stop());
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Barcode mode with @zxing/library
  useEffect(() => {
    if (!isOpen || mode !== "barcode") {
      if (mode === "barcode") {
        hasScannedRef.current = false;
        stopScanner();
      }
      return;
    }

    let cancelled = false;

    const startBarcode = async () => {
      setError(null);
      setIsStarting(true);
      hasScannedRef.current = false;

      // Wait for video element to be in DOM
      await new Promise((r) => setTimeout(r, 500));
      if (cancelled || !mountedRef.current) return;

      const videoEl = videoRef.current;
      if (!videoEl) {
        console.error("[BarcodeScanner] Video element not found");
        setError("Elemento de vídeo não encontrado. Tente novamente.");
        setIsStarting(false);
        return;
      }

      try {
        // Configure ZXing hints for 1D barcodes (Brazilian boletos use ITF)
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.ITF,
          BarcodeFormat.CODE_128,
          BarcodeFormat.CODE_39,
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
          BarcodeFormat.CODABAR,
        ]);
        hints.set(DecodeHintType.TRY_HARDER, true);

        // 500ms interval gives more processing time per frame
        const reader = new BrowserMultiFormatReader(hints, 500);
        zxingReaderRef.current = reader;

        console.log("[BarcodeScanner] Starting ZXing continuous decode...");

        // Use decodeFromConstraints which handles camera + continuous decoding
        await reader.decodeFromConstraints(
          {
            video: {
              facingMode: { ideal: "environment" },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
          },
          videoEl,
          (result, err) => {
            if (cancelled || hasScannedRef.current) return;
            if (result) {
              hasScannedRef.current = true;
              const text = result.getText();
              const format = result.getBarcodeFormat();
              console.log("[BarcodeScanner] ZXing scanned:", text, "format:", format);
              onScan(text);
              setTimeout(() => stopScanner(), 100);
            }
            // Log decode errors only occasionally for debugging
            if (err && !(err instanceof Error && err.message.includes("No MultiFormat"))) {
              // This is normal - no barcode found in current frame
            }
          }
        );

        console.log("[BarcodeScanner] ZXing decode started successfully");
        if (mountedRef.current) setIsStarting(false);
      } catch (err: any) {
        console.error("[BarcodeScanner] Error:", err);
        if (!mountedRef.current) return;
        if (err?.toString?.().includes("NotAllowedError")) {
          setError("Permissão da câmera negada. Habilite nas configurações do navegador.");
        } else if (err?.toString?.().includes("NotFoundError")) {
          setError("Nenhuma câmera encontrada no dispositivo.");
        } else {
          setError(`Erro ao acessar a câmera: ${err?.message || err}`);
        }
        setIsStarting(false);
      }
    };

    startBarcode();

    return () => {
      cancelled = true;
      stopScanner();
    };
  }, [isOpen, mode]);

  // QR Code mode with html5-qrcode (unchanged, works well)
  useEffect(() => {
    if (!isOpen || mode !== "qrcode") {
      if (mode === "qrcode") {
        hasScannedRef.current = false;
        stopScanner();
      }
      return;
    }

    let cancelled = false;

    const startQR = async () => {
      setError(null);
      setIsStarting(true);
      hasScannedRef.current = false;

      await new Promise((r) => setTimeout(r, 500));
      if (cancelled || !mountedRef.current) return;

      const containerId = containerIdRef.current;
      const element = document.getElementById(containerId);
      if (!element) {
        setError("Elemento do scanner não encontrado.");
        setIsStarting(false);
        return;
      }

      if (element.clientWidth === 0 || element.clientHeight === 0) {
        element.style.width = "100%";
        element.style.minHeight = "300px";
      }

      try {
        stopScanner();

        const scanner = new Html5Qrcode(containerId, {
          formatsToSupport: qrFormats,
          verbose: false,
        });

        if (cancelled) {
          scanner.stop().catch(() => {});
          return;
        }

        html5ScannerRef.current = scanner;

        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          (decodedText) => {
            if (hasScannedRef.current) return;
            hasScannedRef.current = true;
            console.log("[BarcodeScanner] QR scanned:", decodedText);
            onScan(decodedText);
            void stopScanner();
          },
          () => {}
        );

        if (mountedRef.current) setIsStarting(false);
      } catch (err: any) {
        console.error("[BarcodeScanner] QR Error:", err);
        if (!mountedRef.current) return;
        if (err?.toString?.().includes("NotAllowedError")) {
          setError("Permissão da câmera negada. Habilite nas configurações do navegador.");
        } else if (err?.toString?.().includes("NotFoundError")) {
          setError("Nenhuma câmera encontrada no dispositivo.");
        } else {
          setError(`Erro ao acessar a câmera: ${err?.message || err}`);
        }
        setIsStarting(false);
      }
    };

    startQR();

    return () => {
      cancelled = true;
      stopScanner();
    };
  }, [isOpen, mode]);

  const handleClose = () => {
    stopScanner();
    onClose();
  };

  const handleManualInput = () => {
    stopScanner();
    onClose();
    onManualInput?.();
  };

  // Fullscreen barcode mode - uses native <video> + ZXing
  if (mode === "barcode") {
    if (!isOpen) return null;

    return (
      <div className="fixed inset-0 z-[100] bg-black flex flex-col">
        <div className="relative flex-1 overflow-hidden">
          {error ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 px-6">
              <AlertCircle className="h-16 w-16 text-destructive" />
              <p className="text-center text-white text-lg">{error}</p>
              <Button
                className="bg-accent hover:bg-accent/90 text-accent-foreground font-bold px-8 py-3 text-lg rounded-lg"
                onClick={handleClose}
              >
                VOLTAR
              </Button>
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                playsInline
                muted
                autoPlay
              />

              {/* Horizontal scan guide line */}
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-10">
                <div className="w-[80vw] h-[2px] bg-accent shadow-[0_0_8px_rgba(34,197,94,0.8)]" />
              </div>

              {/* Guide text */}
              <div className="absolute top-8 left-0 right-0 pointer-events-none z-10">
                <p className="text-white/90 text-sm font-medium text-center tracking-wider">
                  Posicione o código de barras na linha verde
                </p>
              </div>

              {/* Action buttons */}
              <div className="absolute bottom-8 left-0 right-0 flex justify-center gap-4 z-10 px-4">
                <Button
                  className="bg-accent hover:bg-accent/90 text-accent-foreground font-bold px-6 py-4 text-base rounded-lg shadow-lg"
                  onClick={handleClose}
                >
                  <ArrowLeft className="mr-2 h-5 w-5" />
                  VOLTAR
                </Button>
                <Button
                  className="bg-accent hover:bg-accent/90 text-accent-foreground font-bold px-6 py-4 text-base rounded-lg shadow-lg"
                  onClick={handleManualInput}
                >
                  <Keyboard className="mr-2 h-5 w-5" />
                  DIGITAR CÓDIGO
                </Button>
              </div>

              {isStarting && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-20">
                  <p className="text-white text-lg font-medium">Iniciando câmera...</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  // QR Code mode - keep dialog with html5-qrcode
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-4 pb-2">
          <DialogTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" />
            Escanear QR Code
          </DialogTitle>
        </DialogHeader>

        <div className="px-4 pb-4">
          {error ? (
            <div className="flex flex-col items-center gap-4 py-8">
              <AlertCircle className="h-12 w-12 text-destructive" />
              <p className="text-center text-sm text-muted-foreground">{error}</p>
              <Button variant="outline" onClick={handleClose}>
                Fechar
              </Button>
            </div>
          ) : (
            <>
              <div
                id={containerIdRef.current}
                className="w-full rounded-lg overflow-hidden bg-black"
                style={{ minHeight: "300px" }}
              />
              {isStarting && (
                <p className="text-center text-sm text-muted-foreground mt-3">
                  Iniciando câmera...
                </p>
              )}
              <p className="text-center text-xs text-muted-foreground mt-3">
                Aponte a câmera para o QR Code Pix
              </p>
            </>
          )}

          <Button variant="outline" className="w-full mt-4" onClick={handleClose}>
            <X className="mr-2 h-4 w-4" />
            Cancelar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
