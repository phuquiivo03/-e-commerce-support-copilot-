import { NextResponse } from 'next/server';

/**
 * OpenAPI 3.1 description of the REST API, served as JSON for Swagger UI
 * (see /api-docs). Hand-maintained to match apps/web/src/app/api/**.
 */
const spec = {
  openapi: '3.1.0',
  info: {
    title: 'E-commerce Support Copilot API',
    version: '0.1.0',
    description:
      'REST API for the support copilot workspace. Authentication uses the Supabase session ' +
      'cookies issued by POST /api/auth/login. Row-level authorization is enforced in PostgreSQL (RLS).',
  },
  tags: [
    { name: 'auth' },
    { name: 'orders' },
    { name: 'tickets' },
    { name: 'copilot' },
    { name: 'returns' },
    { name: 'knowledge-base' },
    { name: 'admin' },
  ],
  components: {
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              details: {},
            },
            required: ['code', 'message'],
          },
        },
        required: ['error'],
      },
      CopilotResponse: {
        type: 'object',
        properties: {
          behavior: { type: 'string', enum: ['ANSWER', 'CLARIFY', 'PARTIAL_ANSWER', 'ABSTAIN', 'ESCALATE'] },
          message: { type: 'string' },
          citations: {
            type: 'array',
            items: {
              oneOf: [
                {
                  type: 'object',
                  properties: {
                    kind: { type: 'string', const: 'policy_chunk' },
                    chunkId: { type: 'string', format: 'uuid' },
                    documentId: { type: 'string', format: 'uuid' },
                    documentTitle: { type: 'string' },
                    documentVersion: { type: 'integer' },
                    heading: { type: ['string', 'null'] },
                    quote: { type: 'string' },
                  },
                },
                {
                  type: 'object',
                  properties: {
                    kind: { type: 'string', const: 'order_record' },
                    orderId: { type: 'string', format: 'uuid' },
                    orderNumber: { type: 'string' },
                    fields: { type: 'array', items: { type: 'string' } },
                  },
                },
              ],
            },
          },
          missingInformation: { type: 'array', items: { type: 'string' } },
          suggestedNextActions: { type: 'array', items: { type: 'string' } },
          requiresHumanReview: { type: 'boolean' },
        },
        required: ['behavior', 'message', 'citations', 'missingInformation', 'suggestedNextActions', 'requiresHumanReview'],
      },
    },
    securitySchemes: {
      sessionCookie: { type: 'apiKey', in: 'cookie', name: 'sb-auth-token' },
    },
  },
  security: [{ sessionCookie: [] }],
  paths: {
    '/api/auth/login': {
      post: {
        tags: ['auth'],
        summary: 'Sign in with email + password (sets session cookies)',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { email: { type: 'string', format: 'email' }, password: { type: 'string' } },
                required: ['email', 'password'],
              },
            },
          },
        },
        responses: {
          '200': { description: 'Authenticated' },
          '401': { description: 'Invalid credentials', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/auth/logout': { post: { tags: ['auth'], summary: 'Sign out', responses: { '200': { description: 'Signed out' } } } },
    '/api/auth/me': { get: { tags: ['auth'], summary: 'Current user and role', responses: { '200': { description: 'User' }, '401': { description: 'Unauthenticated' } } } },
    '/api/orders': {
      get: {
        tags: ['orders'],
        summary: 'List orders (RLS-scoped: customers see their own)',
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
          { name: 'status', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Paginated orders' }, '401': { description: 'Unauthenticated' } },
      },
    },
    '/api/orders/{id}': {
      get: {
        tags: ['orders'],
        summary: 'Order detail with items, payment, shipments, and shipment events',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          '200': { description: 'Order detail' },
          '404': { description: 'Not found or not accessible (RLS)' },
        },
      },
    },
    '/api/orders/{id}/return-eligibility': {
      get: {
        tags: ['orders'],
        summary: 'Deterministic return-eligibility evaluation for the order',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          '200': { description: 'Eligibility result (ELIGIBLE | NOT_ELIGIBLE | INDETERMINATE)' },
          '404': { description: 'Not found or not accessible' },
        },
      },
    },
    '/api/tickets': {
      get: {
        tags: ['tickets'],
        summary: 'Ticket inbox with filters',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string' }, description: 'repeatable' },
          { name: 'category', in: 'query', schema: { type: 'string' } },
          { name: 'priority', in: 'query', schema: { type: 'string' }, description: 'repeatable' },
          { name: 'q', in: 'query', schema: { type: 'string' }, description: 'subject search' },
        ],
        responses: { '200': { description: 'Paginated tickets' } },
      },
      post: {
        tags: ['tickets'],
        summary: 'Create a ticket (customers only)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  subject: { type: 'string' },
                  body: { type: 'string' },
                  category: { type: 'string' },
                  priority: { type: 'string' },
                  orderNumber: { type: 'string', nullable: true },
                },
                required: ['subject', 'body'],
              },
            },
          },
        },
        responses: { '201': { description: 'Created' }, '403': { description: 'Only customers can create tickets' } },
      },
    },
    '/api/tickets/{id}': {
      get: {
        tags: ['tickets'],
        summary: 'Ticket detail: conversation, customer, order snapshot, copilot runs',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'Ticket detail' }, '404': { description: 'Not found or not accessible' } },
      },
      patch: {
        tags: ['tickets'],
        summary: 'Staff update: status / priority / category / assignment',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'Updated' }, '403': { description: 'Staff only' } },
      },
      put: {
        tags: ['tickets'],
        summary: 'Escalate ticket to human review (staff)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'Escalated' }, '403': { description: 'Staff only' } },
      },
    },
    '/api/tickets/{id}/messages': {
      get: {
        tags: ['tickets'],
        summary: 'Conversation messages',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'Messages' } },
      },
      post: {
        tags: ['tickets'],
        summary: 'Post a reply (customers on own tickets, staff on any)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '201': { description: 'Message created' }, '403': { description: 'Rejected by RLS' } },
      },
    },
    '/api/tickets/{id}/draft': {
      post: {
        tags: ['copilot'],
        summary: 'Generate an AI draft reply (staff only); persists draft, citations, and trace',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          '200': { description: 'Copilot run result including validated citations' },
          '403': { description: 'Staff only' },
          '404': { description: 'Ticket not found' },
        },
      },
    },
    '/api/returns': {
      get: { tags: ['returns'], summary: 'List return requests (RLS-scoped)', responses: { '200': { description: 'Paginated return requests' } } },
      post: {
        tags: ['returns'],
        summary: 'Create a return request (idempotent via Idempotency-Key semantics)',
        description:
          'Requires a client-generated idempotencyKey. Replaying the same (order, key) pair returns the original request without creating a duplicate.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  orderId: { type: 'string', format: 'uuid' },
                  idempotencyKey: { type: 'string', minLength: 8 },
                  reason: { type: 'string' },
                  itemIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
                  eligibility: { type: 'object', nullable: true },
                },
                required: ['orderId', 'idempotencyKey', 'reason'],
              },
            },
          },
        },
        responses: {
          '201': { description: 'Created' },
          '200': { description: 'Idempotent replay (existing request returned)' },
          '403': { description: 'Not the order owner' },
          '409': { description: 'Active return already exists / order cancelled' },
        },
      },
    },
    '/api/kb/documents': {
      get: { tags: ['knowledge-base'], summary: 'List documents (staff)', responses: { '200': { description: 'Documents' } } },
      post: { tags: ['knowledge-base'], summary: 'Create a document (admin, starts as DRAFT)', responses: { '201': { description: 'Created' }, '403': { description: 'Admin only' } } },
    },
    '/api/kb/documents/{id}': {
      get: {
        tags: ['knowledge-base'],
        summary: 'Document detail with indexed chunks and recent ingestion jobs',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'Document detail' }, '404': { description: 'Not found' } },
      },
      patch: {
        tags: ['knowledge-base'],
        summary: 'Edit content/metadata (admin); content edits re-queue ingestion',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'Updated' }, '403': { description: 'Admin only' } },
      },
    },
    '/api/kb/documents/{id}/publish': {
      post: {
        tags: ['knowledge-base'],
        summary: 'Publish this version and supersede the previously published one (admin)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'Published + ingestion queued' }, '403': { description: 'Admin only' } },
      },
    },
    '/api/kb/documents/{id}/ingest': {
      post: {
        tags: ['knowledge-base'],
        summary: 'Re-queue ingestion (admin)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '202': { description: 'Queued' }, '403': { description: 'Admin only' } },
      },
    },
    '/api/kb/jobs': {
      get: { tags: ['knowledge-base'], summary: 'Ingestion job statuses (admin)', responses: { '200': { description: 'Jobs' } } },
    },
    '/api/audit-logs': {
      get: { tags: ['admin'], summary: 'Audit log feed (admin)', responses: { '200': { description: 'Logs' }, '403': { description: 'Admin only' } } },
    },
    '/api/eval': {
      get: { tags: ['admin'], summary: 'Latest evaluation run (staff)', responses: { '200': { description: 'Run or null' } } },
    },
  },
};

export async function GET() {
  return NextResponse.json(spec);
}
