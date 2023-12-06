async function Startup() {
  await executeInWindow(`window.helpers = {
    now: () => new Date(),
  }`);
}
