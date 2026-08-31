"use client";

import InlineEditableTable from "./InlineEditableTable";
import "./inline-editable-table.css";

const ROLE_OPTIONS = [
  "Director of Photography",
  "Gaffer",
  "Sound Mixer",
  "1st AC",
  "Editor",
  "Colorist",
  "Production Assistant",
  "Grip",
];

const STATUS_OPTIONS = ["Confirmed", "Tentative", "Hold"];

const CURRENCY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const COLUMNS = [
  {
    key: "name",
    label: "Name",
    type: "text",
    parse: (raw) => {
      const trimmed = raw.trim();
      return trimmed ? trimmed : null;
    },
  },
  {
    key: "role",
    label: "Role",
    type: "select",
    options: ROLE_OPTIONS,
    parse: (raw) => (ROLE_OPTIONS.includes(raw) ? raw : null),
  },
  {
    key: "rate",
    label: "Day rate",
    type: "number",
    align: "right",
    format: (value) => CURRENCY.format(value),
    parse: (raw) => {
      const trimmed = raw.trim();
      if (!trimmed) return null;
      const value = Number(trimmed);
      if (!Number.isFinite(value) || value < 0) return null;
      return Math.round(value);
    },
  },
  {
    key: "status",
    label: "Status",
    type: "select",
    options: STATUS_OPTIONS,
    parse: (raw) => (STATUS_OPTIONS.includes(raw) ? raw : null),
  },
];

const ROWS = [
  { id: "priya-desai", name: "Priya Desai", role: "Director of Photography", rate: 950, status: "Confirmed" },
  { id: "marcus-webb", name: "Marcus Webb", role: "Gaffer", rate: 620, status: "Confirmed" },
  { id: "elena-ruiz", name: "Elena Ruiz", role: "Sound Mixer", rate: 580, status: "Tentative" },
  { id: "jamal-carter", name: "Jamal Carter", role: "1st AC", rate: 450, status: "Confirmed" },
  { id: "sofia-bianchi", name: "Sofia Bianchi", role: "Editor", rate: 700, status: "Hold" },
  { id: "tom-okafor", name: "Tom Okafor", role: "Colorist", rate: 750, status: "Tentative" },
  { id: "grace-lin", name: "Grace Lin", role: "Production Assistant", rate: 320, status: "Confirmed" },
  { id: "diego-alvarez", name: "Diego Alvarez", role: "Grip", rate: 400, status: "Confirmed" },
];

export default function InlineEditableTableExperience() {
  return (
    <main className="iet bg-surface text-ink min-h-dvh">
      <div className="iet__page">
        <h1 className="text-title-sm sm:text-title">Crew roster</h1>
        <InlineEditableTable columns={COLUMNS} initialRows={ROWS} label="Crew roster" />
      </div>
    </main>
  );
}
