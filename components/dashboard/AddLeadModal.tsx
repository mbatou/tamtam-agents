"use client";

import { useState, type FormEvent } from "react";
import { useToast } from "./Toast";

export function AddLeadModal({
  token,
  onClose,
  onCreated,
}: {
  token: string;
  onClose: () => void;
  onCreated: () => void;
}): JSX.Element {
  const [company, setCompany] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!company.trim()) {
      toast.push("Company is required", "error");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/dashboard/leads?token=${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            company: company.trim(),
            contact_name: contactName.trim() || undefined,
            email: email.trim() || undefined,
            phone: phone.trim() || undefined,
            notes: notes.trim() || undefined,
          }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.push("Lead added — Kofi will pick it up tomorrow", "success");
      onCreated();
      onClose();
    } catch (err) {
      toast.push(
        `Failed to add lead: ${err instanceof Error ? err.message : "unknown"}`,
        "error",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-lg border border-dakar-border bg-dakar-surface p-6 shadow-xl">
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-semibold text-dakar-text">Add lead</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-dakar-muted hover:text-dakar-text"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <Field label="Company" required>
            <input
              type="text"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              required
              className="w-full rounded-md border border-dakar-border bg-dakar-bg px-3 py-2 text-sm text-dakar-text outline-none focus:border-dakar-orange"
            />
          </Field>
          <Field label="Contact name">
            <input
              type="text"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              className="w-full rounded-md border border-dakar-border bg-dakar-bg px-3 py-2 text-sm text-dakar-text outline-none focus:border-dakar-orange"
            />
          </Field>
          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-dakar-border bg-dakar-bg px-3 py-2 text-sm text-dakar-text outline-none focus:border-dakar-orange"
            />
          </Field>
          <Field label="Phone">
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full rounded-md border border-dakar-border bg-dakar-bg px-3 py-2 text-sm text-dakar-text outline-none focus:border-dakar-orange"
            />
          </Field>
          <Field label="Notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-dakar-border bg-dakar-bg px-3 py-2 text-sm text-dakar-text outline-none focus:border-dakar-orange"
            />
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-dakar-border px-4 py-2 text-sm text-dakar-muted hover:text-dakar-text"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-dakar-orange px-4 py-2 text-sm font-medium text-white hover:bg-dakar-orange/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Adding…" : "Add lead"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <label className="block">
      <span className="mb-1 block text-[0.65rem] uppercase tracking-[0.15em] text-dakar-muted">
        {label}
        {required && <span className="ml-1 text-dakar-orange">*</span>}
      </span>
      {children}
    </label>
  );
}
