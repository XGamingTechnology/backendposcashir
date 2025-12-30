import escpos from "escpos";
escpos.USB = require("escpos-usb");

export function printOrder(order) {
  const device = new escpos.USB();
  const printer = new escpos.Printer(device);

  device.open(() => {
    printer.align("CT").text("SOTO IBUK SENOPATI").text("----------------------").align("LT");

    order.items.forEach((i) => {
      printer.text(`${i.name} x${i.qty} ${i.price * i.qty}`);
    });

    printer.text("----------------------").text(`TOTAL: ${order.total}`).cut().close();
  });
}
