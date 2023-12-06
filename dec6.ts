import { WebUI } from "https://deno.land/x/webui@2.4.4/mod.ts";

const myWindow = new WebUI();
myWindow.show('<html><script src="webui.js"></script> Hello World! </html>');
myWindow.run('alert("first")')
await WebUI.wait();
