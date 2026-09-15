"use client";

export default function CopyValue({ value, label = "Copy" }: { value: string | number; label?: string }) {
  const textValue = String(value || "").trim();
  return (
    <button
      className="copy-value"
      type="button"
      disabled={!textValue}
      onClick={() => navigator.clipboard.writeText(textValue)}
    >
      {label}
    </button>
  );
}
