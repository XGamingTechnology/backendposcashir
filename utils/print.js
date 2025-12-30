// // utils/print.js
// import escpos from "escpos";
// escpos.USB = require("escpos-usb");

// export function getPrinter() {
//   const devices = escpos.USB.find(); // Deteksi semua printer USB
//   if (devices && devices.length > 0) {
//     return new escpos.USB(devices[0]); // Ambil printer pertama
//   }
//   throw new Error("Printer tidak ditemukan");
// }

// export function printOrder(order) {
//   const device = getPrinter();
//   const printer = new escpos.Printer(device);
//   device.open(() => {
//     // ... perintah cetak
//     printer.cut().close();
//   });
// }
