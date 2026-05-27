import { addEvent, createTrace, finishTrace } from "./store.js";

export async function runScenario({ shouldFail }) {
  const trace = createTrace({
    name: shouldFail ? "POST /checkout with stale inventory" : "POST /checkout happy path",
    service: "api-gateway",
    metadata: {
      route: "POST /checkout",
      userHash: "usr_7f3a",
      release: "checkout-service@0.1.0",
    },
  });

  addEvent(trace.traceId, {
    service: "api-gateway",
    type: "http.request",
    message: "Accepted checkout request",
    data: { method: "POST", path: "/checkout", body: { sku: "W3C-KEY", quantity: 2 } },
  });

  await pause(12);
  addEvent(trace.traceId, {
    service: "auth-service",
    type: "http.call",
    message: "Validated user session",
    data: { target: "auth-service", statusCode: 200, durationMs: 11 },
  });

  await pause(18);
  addEvent(trace.traceId, {
    service: "inventory-service",
    type: "db.query",
    message: "Loaded inventory row",
    data: { table: "inventory", sku: "W3C-KEY", available: shouldFail ? 1 : 5 },
  });

  if (shouldFail) {
    await pause(9);
    addEvent(trace.traceId, {
      service: "inventory-service",
      type: "business.invariant_failed",
      level: "error",
      message: "Requested quantity exceeds available inventory",
      data: { requested: 2, available: 1, invariant: "requested <= available" },
    });

    await pause(5);
    return finishTrace(trace.traceId, {
      failed: true,
      service: "checkout-service",
      statusCode: 409,
      reason: "Inventory invariant failed before payment authorization",
    });
  }

  await pause(14);
  addEvent(trace.traceId, {
    service: "payment-service",
    type: "http.call",
    message: "Payment authorized",
    data: { target: "payment-service", statusCode: 200, amount: 39.98 },
  });

  await pause(7);
  addEvent(trace.traceId, {
    service: "checkout-service",
    type: "state.change",
    message: "Order marked confirmed",
    data: { orderId: "ord_demo_ok", before: "pending", after: "confirmed" },
  });

  return finishTrace(trace.traceId, {
    failed: false,
    service: "checkout-service",
    statusCode: 201,
  });
}

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
