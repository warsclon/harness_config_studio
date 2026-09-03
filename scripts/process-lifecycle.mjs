function hasExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

export async function terminateChild(child, options = {}) {
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (hasExited(child)) return;

  await new Promise((resolve, reject) => {
    let settled = false;
    let gracefulTimer;
    let forcedTimer;

    const cleanup = () => {
      if (gracefulTimer) clearTimeout(gracefulTimer);
      if (forcedTimer) clearTimeout(forcedTimer);
      child.off("exit", onExit);
      child.off("error", onError);
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error); else resolve();
    };
    const onExit = () => finish();
    const onError = (error) => finish(error);

    child.once("exit", onExit);
    child.once("error", onError);
    gracefulTimer = setTimeout(() => {
      if (hasExited(child)) {
        finish();
        return;
      }
      child.kill("SIGKILL");
      forcedTimer = setTimeout(() => {
        if (hasExited(child)) finish();
        else finish(new Error("Timed out waiting for packaged web server to terminate."));
      }, Math.min(timeoutMs, 1_000));
    }, timeoutMs);

    if (hasExited(child)) {
      finish();
      return;
    }
    try {
      child.kill("SIGTERM");
    } catch (error) {
      if (hasExited(child)) finish();
      else finish(error);
    }
  });
}
