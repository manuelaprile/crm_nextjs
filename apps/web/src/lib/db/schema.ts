import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'

// ---------------------------------------------------------------------
// Enums — espejo de packages/db/migrations/0001_core.sql
// ---------------------------------------------------------------------
export const tenantStatus = pgEnum('tenant_status', [
  'trial', 'active', 'past_due', 'suspended', 'cancelled',
])
export const tenantRole = pgEnum('tenant_role', ['owner', 'admin', 'agent'])
export const waConnStatus = pgEnum('wa_conn_status', [
  'disconnected', 'qr_pending', 'connecting', 'connected', 'logged_out', 'banned',
])
export const msgDirection = pgEnum('msg_direction', ['inbound', 'outbound'])
export const msgStatus = pgEnum('msg_status', [
  'pending', 'sent', 'delivered', 'read', 'failed',
])
export const msgSender = pgEnum('msg_sender', [
  'contact', 'ai', 'operator', 'system',
])

// ---------------------------------------------------------------------
// Identidad
// ---------------------------------------------------------------------
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  avatarUrl: text('avatar_url'),
  isSuperadmin: boolean('is_superadmin').notNull().default(false),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
// Nota: password_hash existe en la base pero NO se mapea acá a propósito.
// El rol de la app no tiene permiso de lectura sobre esa columna; el login
// pasa por la función verify_login(). Ver 0002_rls.sql.

// Catálogo de rubros: consultorio, inmobiliaria, estudio contable…
// Es una tabla y no un enum para poder sumar rubros sin migración, y porque
// el rótulo que ve el usuario (singular, plural y género) vive acá.
export const verticals = pgTable('verticals', {
  code: text('code').primaryKey(),
  singular: text('singular').notNull(),
  plural: text('plural').notNull(),
  articulo: text('articulo').notNull().default('el'),
  position: integer('position').notNull().default(50),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  // El rubro dejó de ser un enum: ahora es una clave al catálogo `verticals`,
  // para poder dar de alta rubros nuevos sin migración. Ver 0013_rubros.sql.
  vertical: text('vertical').notNull().default('generico'),
  status: tenantStatus('status').notNull().default('trial'),
  plan: text('plan').notNull().default('starter'),
  timezone: text('timezone').notNull().default('America/Argentina/Buenos_Aires'),
  locale: text('locale').notNull().default('es-AR'),
  maxUsers: integer('max_users').notNull().default(3),
  maxWaAccounts: integer('max_wa_accounts').notNull().default(1),
  aiMonthlyCostCap: numeric('ai_monthly_cost_cap', { precision: 10, scale: 2 })
    .notNull().default('20.00'),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const tenantUsers = pgTable('tenant_users', {
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: tenantRole('role').notNull().default('agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.userId] })])

// ---------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------
export const stages = pgTable('stages', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  name: text('name').notNull(),
  color: text('color').notNull().default('#6B7280'),
  position: integer('position').notNull().default(0),
  isInitial: boolean('is_initial').notNull().default(false),
  isWon: boolean('is_won').notNull().default(false),
  isLost: boolean('is_lost').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique().on(t.tenantId, t.key), index().on(t.tenantId, t.position)])

export const contacts = pgTable('contacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  displayName: text('display_name').notNull(),
  phone: text('phone'),
  email: text('email'),
  city: text('city'),
  province: text('province'),
  source: text('source'),
  stageId: uuid('stage_id').references(() => stages.id, { onDelete: 'set null' }),
  stageSince: timestamp('stage_since', { withTimezone: true }).notNull().defaultNow(),
  ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true }),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const contactIdentities = pgTable('contact_identities', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  contactId: uuid('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  channel: text('channel').notNull(),
  externalId: text('external_id').notNull(),
  handle: text('handle'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique().on(t.tenantId, t.channel, t.externalId)])

export const stageHistory = pgTable('stage_history', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  contactId: uuid('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  fromStageId: uuid('from_stage_id').references(() => stages.id, { onDelete: 'set null' }),
  toStageId: uuid('to_stage_id').notNull().references(() => stages.id, { onDelete: 'cascade' }),
  changedBy: uuid('changed_by').references(() => users.id, { onDelete: 'set null' }),
  byAi: boolean('by_ai').notNull().default(false),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const tags = pgTable('tags', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  color: text('color').notNull().default('#6B7280'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique().on(t.tenantId, t.name)])

export const contactTags = pgTable('contact_tags', {
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  contactId: uuid('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  tagId: uuid('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.contactId, t.tagId] })])

export const notes = pgTable('notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  contactId: uuid('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  authorUserId: uuid('author_user_id').references(() => users.id, { onDelete: 'set null' }),
  byAi: boolean('by_ai').notNull().default(false),
  body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const customFieldDefs = pgTable('custom_field_defs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  label: text('label').notNull(),
  type: text('type').notNull().default('text'),
  options: jsonb('options').notNull().default([]),
  position: integer('position').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique().on(t.tenantId, t.key)])

export const customFieldValues = pgTable('custom_field_values', {
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  contactId: uuid('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  fieldId: uuid('field_id').notNull().references(() => customFieldDefs.id, { onDelete: 'cascade' }),
  value: jsonb('value'),
}, (t) => [primaryKey({ columns: [t.contactId, t.fieldId] })])

// ---------------------------------------------------------------------
// Mensajería
// ---------------------------------------------------------------------
export const channelAccounts = pgTable('channel_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  channel: text('channel').notNull().default('whatsapp'),
  provider: text('provider').notNull().default('baileys'),
  externalId: text('external_id'),
  label: text('label').notNull().default('Principal'),
  phone: text('phone'),
  status: waConnStatus('status').notNull().default('disconnected'),
  qr: text('qr'),
  qrExpiresAt: timestamp('qr_expires_at', { withTimezone: true }),
  lastError: text('last_error'),
  connectedAt: timestamp('connected_at', { withTimezone: true }),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  channel: text('channel').notNull(),
  provider: text('provider').notNull(),
  accountId: uuid('account_id').notNull().references(() => channelAccounts.id, { onDelete: 'cascade' }),
  externalId: text('external_id').notNull(),
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  participantName: text('participant_name'),
  participantHandle: text('participant_handle'),
  participantPhone: text('participant_phone'),
  participantPicture: text('participant_picture'),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
  lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }),
  unreadCount: integer('unread_count').notNull().default(0),
  aiEnabled: boolean('ai_enabled').notNull().default(true),
  isGroup: boolean('is_group').notNull().default(false),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique().on(t.provider, t.externalId)])

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  channel: text('channel').notNull(),
  provider: text('provider').notNull(),
  externalId: text('external_id'),
  direction: msgDirection('direction').notNull(),
  type: text('type').notNull().default('text'),
  body: text('body'),
  mediaUrl: text('media_url'),
  mediaMime: text('media_mime'),
  status: msgStatus('status').notNull().default('pending'),
  senderKind: msgSender('sender_kind').notNull(),
  senderUserId: uuid('sender_user_id').references(() => users.id, { onDelete: 'set null' }),
  error: text('error'),
  rawPayload: jsonb('raw_payload'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const webhookEvents = pgTable('webhook_events', {
  eventId: text('event_id').primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  kind: text('kind'),
  payload: jsonb('payload'),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  error: text('error'),
})

// ---------------------------------------------------------------------
// IA
// ---------------------------------------------------------------------
export const agentConfigs = pgTable('agent_configs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  channel: text('channel').notNull(),
  enabled: boolean('enabled').notNull().default(false),
  assistantName: text('assistant_name').notNull().default('Asistente'),
  systemPrompt: text('system_prompt'),
  model: text('model').notNull().default('claude-haiku-4-5'),
  enabledTools: text('enabled_tools').array().notNull().default([]),
  maxTurns: integer('max_turns').notNull().default(8),
  handoffKeywords: text('handoff_keywords').array().notNull().default([]),
  businessHours: jsonb('business_hours').notNull().default({}),
  faq: jsonb('faq').notNull().default([]),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique().on(t.tenantId, t.channel)])

export const aiRuns = pgTable('ai_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
  cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
  costUsd: numeric('cost_usd', { precision: 10, scale: 6 }).notNull().default('0'),
  durationMs: integer('duration_ms'),
  stopReason: text('stop_reason'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const aiToolCalls = pgTable('ai_tool_calls', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  runId: uuid('run_id').references(() => aiRuns.id, { onDelete: 'cascade' }),
  conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
  toolName: text('tool_name').notNull(),
  input: jsonb('input'),
  output: jsonb('output'),
  error: text('error'),
  durationMs: integer('duration_ms'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const auditLog = pgTable('audit_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  actorKind: text('actor_kind').notNull().default('user'),
  action: text('action').notNull(),
  entity: text('entity'),
  entityId: text('entity_id'),
  diff: jsonb('diff'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
