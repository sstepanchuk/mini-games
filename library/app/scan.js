// QR decoder for browsers without BarcodeDetector (iPhone). Built into lib/qr-scan.js and loaded only
// when a camera scan starts, so the library page stays small. jsQR © Cosmo Wolfe, Apache-2.0.
import jsQR from 'jsqr';

export const scan = image => jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' })?.data || null;
