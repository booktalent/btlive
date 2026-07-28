/**
 * PaymentReturn — Iter 61
 *
 * Landing page after Easebuzz redirects the browser back from the hosted
 * checkout. We poll /api/payments/easebuzz/status/:txnid until the backend
 * has finished verifying the callback + retrieve API + flipping bookings
 * to `token_paid`.
 */
import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import Nav from "../components/Nav";
import api from "../lib/api";

const MAX_POLL_MS = 25000;
const POLL_INTERVAL_MS = 1500;

export default function PaymentReturn() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const txnid = params.get("txnid") || "";
  const initialStatus = params.get("status") || "pending";
  const [pay, setPay] = useState(null);
  const [waited, setWaited] = useState(0);
  const timer = useRef(null);

  useEffect(() => {
    if (!txnid) return;
    let cancelled = false;
    const started = Date.now();

    const poll = async () => {
      try {
        const r = await api.get(`/payments/easebuzz/status/${txnid}`);
        if (cancelled) return;
        setPay(r.data);
        if (r.data.status === "completed" || r.data.status === "failed") return;
      } catch {
        /* keep polling — payment doc may not exist yet on very fast redirects */
      }
      const elapsed = Date.now() - started;
      setWaited(elapsed);
      if (!cancelled && elapsed < MAX_POLL_MS) {
        timer.current = setTimeout(poll, POLL_INTERVAL_MS);
      }
    };
    poll();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [txnid]);

  if (!txnid) {
    return (
      <div><Nav />
        <div className="container" style={{ paddingTop: 60, textAlign: "center" }}>
          <h1>Missing Transaction</h1>
          <p>No transaction reference provided. If you just paid, check your bookings dashboard.</p>
          <Link to="/customer" className="btn btn-primary" data-testid="return-goto-dashboard">Go to My Bookings</Link>
        </div>
      </div>
    );
  }

  const status = pay?.status || initialStatus;
  const isDone = status === "completed";
  const isFailed = status === "failed";
  const isPending = !isDone && !isFailed;

  return (
    <div data-testid="payment-return-page">
      <Nav />
      <div className="container" style={{ paddingTop: 60, paddingBottom: 80, maxWidth: 640 }}>
        {isPending && (
          <div style={{ textAlign: "center" }}>
            <div className="spinner" style={{ margin: "0 auto 24px" }} />
            <h1 data-testid="return-pending">Verifying your payment…</h1>
            <p className="text-muted">
              We're confirming with the payment gateway. This normally takes a few seconds.
            </p>
            <p className="text-muted" style={{ fontSize: 12 }}>
              Transaction: <code>{txnid}</code>
            </p>
            {waited > 10000 && (
              <p style={{ marginTop: 20, color: "#92400e" }}>
                Still checking… you can safely close this page and check "My Bookings" in a minute.
              </p>
            )}
          </div>
        )}

        {isDone && (
          <div style={{ textAlign: "center" }} data-testid="return-success">
            <div style={{ fontSize: 64, marginBottom: 16 }}>✅</div>
            <h1>Payment Successful</h1>
            <p className="text-muted">Your booking token has been received. The artist has 24 hours to accept.</p>
            <div className="card" style={{ padding: 20, marginTop: 20, textAlign: "left" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span className="text-muted">Amount Paid</span>
                <strong>₹{pay?.amount?.toFixed(2) ?? "—"}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span className="text-muted">Transaction ID</span>
                <code>{txnid}</code>
              </div>
              {pay?.easepayid && (
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span className="text-muted">Gateway Reference</span>
                  <code>{pay.easepayid}</code>
                </div>
              )}
              {(pay?.bookings || []).length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div className="text-muted" style={{ marginBottom: 6 }}>Bookings</div>
                  {pay.bookings.map((b) => (
                    <div key={b.id} style={{ padding: 8, background: "#f9fafb", borderRadius: 6, marginBottom: 6 }}>
                      <strong>{b.ref}</strong> — {b.status}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ marginTop: 24, display: "flex", gap: 12, justifyContent: "center" }}>
              <Link to="/customer" className="btn btn-primary" data-testid="return-view-bookings">View My Bookings</Link>
              <button className="btn btn-secondary" onClick={() => nav("/")} data-testid="return-go-home">Back to Home</button>
            </div>
          </div>
        )}

        {isFailed && (
          <div style={{ textAlign: "center" }} data-testid="return-failed">
            <div style={{ fontSize: 64, marginBottom: 16 }}>❌</div>
            <h1>Payment Failed</h1>
            <p className="text-muted">
              {pay?.failure_reason
                ? `Reason: ${pay.failure_reason}`
                : "The payment could not be completed. No amount was charged."}
            </p>
            <p className="text-muted" style={{ fontSize: 12 }}>
              Transaction: <code>{txnid}</code>
            </p>
            <div style={{ marginTop: 24, display: "flex", gap: 12, justifyContent: "center" }}>
              <button className="btn btn-primary" onClick={() => nav(-1)} data-testid="return-try-again">Try Again</button>
              <Link to="/customer" className="btn btn-secondary" data-testid="return-view-bookings-failed">My Bookings</Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
