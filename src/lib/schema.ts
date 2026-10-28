import { blob, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { SERVICE_CATEGORIES } from "./cost-categories";

/** Times are stored as milliseconds since 1970 (UTC). */
const time = (name: string) => integer(name, { mode: "number" });

export const users = sqliteTable("users", {
  id: integer("id").primaryKey(),
  /** Short lowercase handle used by host scripts, e.g. "alex". */
  handle: text("handle").notNull().unique(),
  name: text("name").notNull(),
  createdAt: time("created_at").notNull(),
});

export const passkeys = sqliteTable("passkeys", {
  /** The credential ID (base64url), as the browser reports it. */
  id: text("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  publicKey: blob("public_key", { mode: "buffer" }).notNull(),
  counter: integer("counter").notNull(),
  transports: text("transports"),
  /** A friendly name such as "1Password" or "iCloud Keychain". */
  label: text("label").notNull(),
  createdAt: time("created_at").notNull(),
  lastUsedAt: time("last_used_at"),
});

export const sessions = sqliteTable("sessions", {
  /** SHA-256 of the cookie token; the token itself is never stored. */
  tokenHash: text("token_hash").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: time("created_at").notNull(),
  expiresAt: time("expires_at").notNull(),
});

/** One-time links, made by a host script, that let someone add a passkey. */
export const setupLinks = sqliteTable("setup_links", {
  tokenHash: text("token_hash").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: time("expires_at").notNull(),
  usedAt: time("used_at"),
});

/** Short-lived WebAuthn challenges, matched to the browser by a cookie. */
export const challenges = sqliteTable("challenges", {
  id: text("id").primaryKey(),
  challenge: text("challenge").notNull(),
  purpose: text("purpose", { enum: ["sign-in", "register"] }).notNull(),
  userId: integer("user_id").references(() => users.id, {
    onDelete: "cascade",
  }),
  expiresAt: time("expires_at").notNull(),
});

/** Small key/value settings, such as the Drive connection and backup status. */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/** The household's cars. Everything except the nickname can be filled in later. */
export const cars = sqliteTable("cars", {
  id: integer("id").primaryKey(),
  nickname: text("nickname").notNull(),
  year: integer("year"),
  make: text("make"),
  model: text("model"),
  trim: text("trim"),
  engine: text("engine"),
  color: text("color"),
  plate: text("plate"),
  vin: text("vin"),
  /** What NHTSA vPIC said about the VIN (JSON of `VinDetails`), kept so it's asked only once. */
  vinDetails: text("vin_details"),
  vinDecodedAt: time("vin_decoded_at"),
  /** The quick-reference card (JSON of `QuickReference`). */
  reference: text("reference"),
  notes: text("notes"),
  createdAt: time("created_at").notNull(),
  updatedAt: time("updated_at").notNull(),
});

/**
 * Odometer readings feed the Mileage Clock. Manual updates come first; fill-ups and service
 * records add their own later, with `sourceId` pointing at the row that made them.
 */
export const odometerReadings = sqliteTable(
  "odometer_readings",
  {
    id: integer("id").primaryKey(),
    carId: integer("car_id")
      .notNull()
      .references(() => cars.id, { onDelete: "cascade" }),
    miles: integer("miles").notNull(),
    /** When the odometer showed this. */
    readAt: time("read_at").notNull(),
    source: text("source", { enum: ["manual", "fill-up", "service"] }).notNull(),
    sourceId: integer("source_id"),
    note: text("note"),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: time("created_at").notNull(),
  },
  (t) => [index("odometer_readings_car_read_at").on(t.carId, t.readAt)],
);

export const serviceRecords = sqliteTable(
  "service_records",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    carId: integer("car_id").notNull().references(() => cars.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["service", "quote"] }).notNull(),
    title: text("title").notNull(),
    /** What the money went on, for the cost breakdown. Guessed from the title when not chosen. */
    category: text("category", { enum: SERVICE_CATEGORIES }).notNull().default("maintenance"),
    /** Calendar date as YYYY-MM-DD; no timezone conversion. */
    date: text("date").notNull(),
    shop: text("shop"),
    miles: integer("miles"),
    totalCents: integer("total_cents"),
    lineItems: text("line_items").notNull(),
    notes: text("notes"),
    requestKey: text("request_key").notNull().unique(),
    revision: integer("revision").notNull().default(1),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: time("created_at").notNull(),
    updatedAt: time("updated_at").notNull(),
  },
  (t) => [index("service_records_car_date").on(t.carId, t.date)],
);

/** Originals live in the database so records and receipts share one atomic backup. */
export const serviceReceipts = sqliteTable(
  "service_receipts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    serviceId: integer("service_id").notNull().references(() => serviceRecords.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    bytes: blob("bytes", { mode: "buffer" }).notNull(),
    createdAt: time("created_at").notNull(),
  },
  (t) => [index("service_receipts_service").on(t.serviceId)],
);

/** US gallons are stored as thousandths; money stays in integer cents. */
export const fuelRecords = sqliteTable("fuel_records", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  carId: integer("car_id").notNull().references(() => cars.id, { onDelete: "cascade" }),
  date: text("date").notNull(),
  miles: integer("miles").notNull(),
  gallonsMilli: integer("gallons_milli").notNull(),
  totalCents: integer("total_cents").notNull(),
  fullTank: integer("full_tank", { mode: "boolean" }).notNull(),
  missedFillups: integer("missed_fillups", { mode: "boolean" }).notNull().default(false),
  notes: text("notes"),
  requestKey: text("request_key").notNull().unique(),
  revision: integer("revision").notNull().default(1),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: time("created_at").notNull(),
  updatedAt: time("updated_at").notNull(),
}, (t) => [index("fuel_records_car_date").on(t.carId, t.date)]);

/** Budget exports can establish a payment without an odometer reading or fuel volume. */
export const budgetFuelPayments = sqliteTable("budget_fuel_payments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  carId: integer("car_id").notNull().references(() => cars.id, { onDelete: "cascade" }),
  date: text("date").notNull(),
  totalCents: integer("total_cents").notNull(),
  payee: text("payee").notNull(),
  memo: text("memo").notNull(),
  sourceFile: text("source_file").notNull(),
  sourceRecord: integer("source_record").notNull(),
  sourceKey: text("source_key").notNull().unique(),
  importedAt: time("imported_at").notNull(),
}, (t) => [index("budget_fuel_payments_car_date").on(t.carId, t.date)]);

/** Import credentials only permit draft submission; approval requires household sign-in. */
export const importTokens = sqliteTable("import_tokens", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: time("created_at").notNull(),
  lastUsedAt: time("last_used_at"),
  revokedAt: time("revoked_at"),
});

export const importDrafts = sqliteTable("import_drafts", {
  id: text("id").primaryKey(),
  carId: integer("car_id").notNull().references(() => cars.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["service", "maintenance"] }).notNull(),
  payload: text("payload").notNull(),
  payloadHash: text("payload_hash").notNull(),
  sourceLabel: text("source_label"),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  tokenId: text("token_id").references(() => importTokens.id, { onDelete: "set null" }),
  status: text("status", { enum: ["draft", "approved", "rejected"] }).notNull().default("draft"),
  approvedRecordId: integer("approved_record_id"),
  revision: integer("revision").notNull().default(1),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: time("created_at").notNull(),
  updatedAt: time("updated_at").notNull(),
}, (t) => [index("import_drafts_status_created").on(t.status, t.createdAt)]);

/** Originals remain with the draft; service approval also copies them to service receipts. */
export const importDraftReceipts = sqliteTable("import_draft_receipts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  draftId: text("draft_id").notNull().references(() => importDrafts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  bytes: blob("bytes", { mode: "buffer" }).notNull(),
  createdAt: time("created_at").notNull(),
}, (t) => [index("import_draft_receipts_draft").on(t.draftId)]);

/** Baselines are user supplied; linked completed service takes precedence when present. */
export const maintenanceSchedules = sqliteTable("maintenance_schedules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  carId: integer("car_id").notNull().references(() => cars.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  intervalMiles: integer("interval_miles"),
  intervalMonths: integer("interval_months"),
  baselineDate: text("baseline_date"),
  baselineMiles: integer("baseline_miles"),
  lastServiceId: integer("last_service_id").references(() => serviceRecords.id, { onDelete: "set null" }),
  sourceDraftId: text("source_draft_id").references(() => importDrafts.id, { onDelete: "set null" }),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  /** Work the owner's manual doesn't call for: shown in its own group, left out of counts and reminders. */
  optional: integer("optional", { mode: "boolean" }).notNull().default(false),
  /** Mark done asks for the four tread depths, as for a tread check or a rotation. */
  asksTread: integer("asks_tread", { mode: "boolean" }).notNull().default(false),
  notes: text("notes"),
  requestKey: text("request_key").notNull().unique(),
  revision: integer("revision").notNull().default(1),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: time("created_at").notNull(),
  updatedAt: time("updated_at").notNull(),
}, (t) => [index("maintenance_schedules_car").on(t.carId)]);

/** A phone or browser that asked for maintenance reminders. The endpoint is the push service's address for it. */
export const pushSubscriptions = sqliteTable("push_subscriptions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  /** A friendly name such as "iPhone". */
  label: text("label").notNull(),
  createdAt: time("created_at").notNull(),
  lastSuccessAt: time("last_success_at"),
  lastFailureAt: time("last_failure_at"),
  lastError: text("last_error"),
  /** The household day ("2026-10-27") this device last received the daily reminder, so a failed device can be retried alone. */
  lastRemindedDay: text("last_reminded_day"),
});

/** When each due schedule was last included in a reminder, so reminders repeat weekly rather than daily. */
export const maintenanceReminders = sqliteTable("maintenance_reminders", {
  scheduleId: integer("schedule_id").primaryKey().references(() => maintenanceSchedules.id, { onDelete: "cascade" }),
  /** The schedule's baseline and intervals when reminded; a change starts a new reminder cycle. */
  cycle: text("cycle").notNull(),
  lastSentAt: time("last_sent_at").notNull(),
});

/** Where a tire went on. Rotations move tires around, so this is where it was installed, not where it is now. */
export const TIRE_POSITIONS = ["lf", "rf", "lr", "rr", "spare"] as const;

/** Each tire the car has had: what it is, when it went on and when it came off. */
export const tires = sqliteTable("tires", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  carId: integer("car_id").notNull().references(() => cars.id, { onDelete: "cascade" }),
  /** Null when old records don't say which corner. */
  position: text("position", { enum: TIRE_POSITIONS }),
  brand: text("brand"),
  model: text("model"),
  size: text("size"),
  /** The last four digits of the DOT code: week and year made, such as "2324". */
  dot: text("dot"),
  installedDate: text("installed_date").notNull(),
  installedMiles: integer("installed_miles"),
  /** The service record for buying or fitting it, when there is one. */
  serviceId: integer("service_id").references(() => serviceRecords.id, { onDelete: "set null" }),
  removedDate: text("removed_date"),
  removedMiles: integer("removed_miles"),
  notes: text("notes"),
  requestKey: text("request_key").notNull().unique(),
  revision: integer("revision").notNull().default(1),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: time("created_at").notNull(),
  updatedAt: time("updated_at").notNull(),
}, (t) => [index("tires_car").on(t.carId)]);

/** Tread depths in 32nds of an inch, taken at a service: a tread check, a rotation or a shop inspection. */
export const treadReadings = sqliteTable("tread_readings", {
  serviceId: integer("service_id").primaryKey().references(() => serviceRecords.id, { onDelete: "cascade" }),
  lf: integer("lf"),
  rf: integer("rf"),
  lr: integer("lr"),
  rr: integer("rr"),
});
