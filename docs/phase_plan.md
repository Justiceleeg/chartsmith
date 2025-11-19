# Vercel AI SDK Migration - Phase Plan

## Overview
Progressive migration from custom Anthropic SDK implementation to Vercel AI SDK. The migration moves **LLM chat streaming** to Next.js API routes while keeping **orchestration, tool execution, database operations, and workspace management** in the Go backend.

**Architecture Split**:
- **Vercel AI SDK (Next.js)**: LLM chat streaming, message history, UI state
- **Go Backend**: Tool execution, database operations, workspace management, file operations, render jobs, plan management
- **Centrifugo**: Non-chat real-time features (render updates, plan updates, workspace events)

**Important Distinction**:
- **Phase 0**: Pure refactoring (make code testable) - no behavior changes
- **Phases 1-2**: New implementation (build + validate streaming endpoint) - additive changes
- **Phase 3**: Re-architecture (switch frontend to AI SDK) - requires new tests for new behavior
- **Phase 4**: Cleanup and verification

## Quick Reference

| Phase | Type | Goal | Key Challenge |
|-------|------|------|---------------|
| **Phase 0** | Prerequisite | Make Go code testable | Extract interfaces, add DI |
| **Phase 1** | New Feature | Build Next.js streaming endpoint | Create AI SDK-powered API route |
| **Phase 2** | Validation | Frontend POC + Go integration | Validate streaming + tool calls work |
| **Phase 3** | Re-architecture | Full frontend migration | Remove Centrifugo for chat |
| **Phase 4** | Cleanup | Remove old code + refactor Go | Clarify Go backend's new role |

**Success Metrics**:
- ✅ All tests pass (before and after each phase)
- ✅ Chat streaming handled by Vercel AI SDK
- ✅ Go backend handles tools, DB, orchestration
- ✅ Centrifugo only used for non-chat features
- ✅ 70%+ test coverage on critical paths
- ✅ Zero regressions in user-facing behavior

## Test Configuration

**Environment Variables**:
```bash
# Required for all tests
TEST_DB_URL=postgresql://localhost:5432/chartsmith_test

# Test modes
TEST_MODE=unit          # Mock all external APIs (default)
TEST_MODE=integration   # Use real LLM APIs (requires keys)

# For integration tests only
ANTHROPIC_API_KEY=sk-... # Required for pre-migration integration tests
GROQ_API_KEY=gsk-...     # Required for intent detection tests
```

**Running Tests**:
```bash
# Frontend
npm run test:unit           # Fast, mocked dependencies
npm run test:integration    # Requires API keys
npm run test:e2e           # Full stack, requires backend running

# Backend
go test ./pkg/llm/... -short              # Unit tests only (mocked)
go test ./pkg/llm/... -run Integration    # Real API calls
go test ./pkg/llm/... -cover              # With coverage report

# Target Coverage
# Critical paths (chat, streaming, tool calling): 80%+
# Supporting functions: 60%+
```

**Test Database Setup**:
```bash
# Create test database
createdb chartsmith_test

# Run migrations
migrate -path ./migrations -database $TEST_DB_URL up

# Test cleanup (after each test)
# Tests should use transactions and rollback for isolation
```

## Phase 0: Refactor for Testability (Prerequisite)
**Goal**: Make code testable without changing behavior

**Why This Matters**: Current code has hard-coded dependencies that can't be mocked. We need to refactor FIRST, then add tests, then migrate.

**Tasks**:
1. **Extract interfaces** in `pkg/llm/`:
   ```go
   type LLMClient interface {
       NewStreaming(ctx context.Context, params MessageParams) Stream
   }
   
   type Stream interface {
       Next() bool
       Current() StreamEvent
       Err() error
   }
   ```

2. **Refactor `ConversationalChatMessage` for dependency injection**:
   ```go
   // Before: client := newAnthropicClient(ctx)
   // After: Accept client as parameter or use interface
   func ConversationalChatMessage(ctx context.Context, client LLMClient, streamCh chan string, doneCh chan error, ...) error
   ```

3. **Create test helpers**:
   - `pkg/llm/testing/mock_client.go` - Mock LLM client
   - `pkg/llm/testing/fixtures.go` - Canned responses
   - `pkg/workspace/testing/db.go` - Test DB with transactions

4. **Add test utilities**:
   - Channel test helpers (collect all values, wait for done)
   - Centrifugo mock (for listener tests)
   - Database transaction wrapper (setup/teardown)

**Testing Requirements**:
- Add 2-3 simple unit tests to verify refactoring didn't break behavior
- Test with real Anthropic SDK (integration test)
- Verify all existing functionality still works

**Success Criteria**:
- Code is dependency-injectable
- Mock implementations exist
- At least one test uses mocks successfully
- No behavior changes (verified by integration tests)

---

## Phase 1: Next.js Streaming Endpoint with AI SDK
**Goal**: Create Next.js API route using Vercel AI SDK for LLM chat streaming

**Why This Order**: Build the new path first (additive) before removing old path (less risky). Validate streaming works before touching existing frontend.

**Architecture Decision**: 
- Next.js handles LLM streaming (Vercel AI SDK)
- Go backend provides context via new REST endpoints (chart structure, relevant files, plan history)
- Go backend handles tool execution when LLM requests tools
- Frontend calls Next.js API route, which orchestrates with Go as needed

**Tasks**:
1. **Install Vercel AI SDK**: `npm install ai @ai-sdk/anthropic`
2. **Create context endpoints in Go** (if not already exposed):
   - `GET /api/workspace/:id/context` → Returns chart structure, relevant files (max 10), plan history
   - `POST /api/workspace/:id/tools/:toolName` → Executes tool, returns result
3. **Create streaming API route**: `chartsmith-app/app/api/chat/stream/route.ts`
   - Accept: workspaceId, message, role, sessionId
   - Fetch context from Go backend
   - Build messages array (system prompt + context + history + user message)
   - Stream response using AI SDK
   - Handle tool calls: pause stream → call Go backend → resume with tool results
4. **Add feature flag**: Environment variable `USE_AI_SDK_CHAT=false` (default off)

**Testing Requirements**:

**Before Starting Phase 1** - Add these tests:
- `chartsmith-app/app/api/chat/__tests__/stream.test.ts`:
  - Test API route accepts POST with required fields (workspaceId, message, role)
  - Test API route returns streaming response (text/event-stream)
  - Test API route validates authentication
  - Test API route fetches context from Go backend
  - Test API route includes system prompts based on role (developer/operator)
  - Test streaming response format matches AI SDK format
  - Test error handling (missing params, auth failure, Go backend down)
  - **Use mocked AI SDK responses**
  - **Use mocked Go backend HTTP calls**
- `chartsmith-app/lib/workspace/__tests__/context.test.ts` (if creating context client):
  - Test fetching workspace context from Go backend
  - Test context includes chart structure, files, plan history
  - Test context limits files to max 10
  - Test error handling

**Backend Tests** (Go context endpoints):
- `pkg/api/workspace_context_test.go`:
  - Test context endpoint returns correct structure
  - Test context includes relevant files (max 10)
  - Test context includes plan history
  - Test authentication required
  - **Use test database with transactions**

**Tests That Should Pass After Implementation**:
- All new API route tests pass
- Integration test: `curl -N -X POST http://localhost:3000/api/chat/stream` streams response
- Verify streaming format compatible with AI SDK React hooks
- Verify Go context endpoints work
- Verify tool calling flow works (LLM → Next.js → Go tool execution → Next.js → continue stream)

**Verification**:
- Run: `npm test app/api/chat/__tests__/stream.test.ts`
- Run: `go test ./pkg/api/...`
- Manual curl test:
  ```bash
  curl -N -X POST http://localhost:3000/api/chat/stream \
    -H "Content-Type: application/json" \
    -H "Cookie: <auth-cookie>" \
    -d '{"workspaceId":"123","message":"test","role":"developer"}'
  ```
- Verify response streams text chunks in AI SDK format

**Success Criteria**:
- API route streams LLM responses using Vercel AI SDK
- Go backend provides context (no LLM calls in Go yet)
- Tool calling works (Next.js ↔ Go communication)
- Feature flag controls new vs old path
- Can be tested independently (curl/Postman)

---

## Phase 2: Frontend POC - Validate New Architecture
**Goal**: Build minimal frontend proof-of-concept to validate streaming works end-to-end

**Why This Phase**: Validate the new architecture works before full migration. Test streaming, tool calling, and Go integration with real UI.

**Tasks**:
1. **Create POC component**: `chartsmith-app/components/ChatContainerAISDK.tsx`
   - Use Vercel AI SDK's `useChat` hook
   - Point to new `/api/chat/stream` endpoint
   - Keep side-by-side with existing `ChatContainer.tsx`
   - Add UI toggle or separate route to test POC
2. **Test integration points**:
   - Verify streaming text displays correctly
   - Verify tool calls work (LLM → Next.js → Go → back to LLM)
   - Verify message history persists
   - Verify role selection works (developer/operator)
3. **Compare with existing behavior**:
   - Same system prompts used
   - Same context fetched
   - Same tool execution logic
   - Same user experience (just different data flow)

**Testing Requirements**:

**Before Starting Phase 2** - Add these tests:
- `chartsmith-app/components/__tests__/ChatContainerAISDK.test.tsx`:
  - Test component renders with `useChat` hook
  - Test form submission triggers chat request
  - Test streaming updates display correctly
  - Test input clears after submission
  - Test role selector updates messages
  - Test loading states handled by `useChat`
  - Test error states handled by `useChat`
  - **Use mocked `useChat` hook responses**
- E2E test: `chartsmith-app/tests/chat-ai-sdk-poc.spec.ts`:
  - Test POC route loads
  - Test user can send message and see streaming response
  - Test multiple messages in conversation
  - Test tool calling works (if applicable)
  - **Use real backend and API route**

**Tests That Should Pass After Implementation**:
- All new tests pass
- POC component works identically to old component (user perspective)
- Streaming performance is equal or better
- Tool calling works correctly
- Integration test: Full chat flow works with AI SDK

**Verification**:
- Run: `npm test components/__tests__/ChatContainerAISDK.test.tsx`
- Run: `npm run test:e2e -- chat-ai-sdk-poc.spec.ts`
- Manual: Use POC UI, compare with existing chat
- Manual: Test tool calling (e.g., "what's the latest version of nginx chart?")
- Compare: Response quality, speed, and behavior match

**Success Criteria**:
- POC component works with `useChat` hook
- Streaming displays correctly in UI
- Tool calling integrated with Go backend
- Performance meets or exceeds current implementation
- Ready to migrate main chat component

---

## Phase 3: Frontend UI Hooks - Migrate to AI SDK React Hooks
**Goal**: Replace custom chat state with Vercel AI SDK React hooks

**⚠️ This is Re-Architecture, Not Refactoring**: The data flow fundamentally changes from Centrifugo WebSocket to direct AI SDK streaming. Tests cannot pass "before and after" because the behavior actually changes.

**Tasks**:
- Install `ai` package
- Set up `useChat` or `useCompletion` hook
- Migrate one chat component at a time (start with `ChatContainer.tsx`)
- Remove Centrifugo dependency for chat message updates
- Keep Centrifugo for other real-time features (renders, plans, etc.)

**Testing Requirements**:

**Before Starting Phase 3** - Add these tests for CURRENT behavior:
- `chartsmith-app/lib/llm/__tests__/prompt-type.test.ts`:
  - Test `promptType()` returns `PromptType.Plan` when LLM response contains "plan"
  - Test `promptType()` returns `PromptType.Chat` when LLM response contains "chat"
  - Test `promptType()` defaults to `PromptType.Chat` for ambiguous responses
  - Test `promptType()` throws error when API call fails
  - **Use mocked Anthropic SDK responses**
- `chartsmith-app/components/__tests__/ChatContainer.test.tsx`:
  - Test form submission creates chat message via `createChatMessageAction`
  - Test input is cleared after message submission
  - Test empty input prevents submission
  - Test `isRendering` state prevents submission
  - Test role selector updates `selectedRole` state
  - Test component renders messages from `messagesAtom`
  - **Current behavior**: Messages update via `useCentrifugo` hook
- `chartsmith-app/hooks/__tests__/useCentrifugo.test.ts`:
  - Test `handleChatMessageUpdated` updates messages atom correctly
  - Test streaming message updates (partial responses)
  - Test `isComplete` flag handling
  - Test Centrifugo handles non-chat events (render updates, plan updates)
  - Test Centrifugo connection/disconnection handling
  - **Current behavior**: Chat messages come through Centrifugo
- E2E test: `chartsmith-app/tests/chat-flow-centrifugo.spec.ts`:
  - Test complete chat flow with Centrifugo: submit message → Centrifugo updates → display message
  - **This test documents CURRENT behavior** (will be replaced, not updated)

**Tests That Should Pass Before Implementation**:
- All new tests above pass with current Centrifugo-based implementation
- Existing `chat-scrolling.spec.ts` E2E test passes
- Verify Centrifugo handles chat messages currently

**After Phase 3** - Add NEW tests for NEW behavior:
- `chartsmith-app/lib/llm/__tests__/prompt-type-ai-sdk.test.ts`:
  - Same tests as `prompt-type.test.ts` but with AI SDK mocks (if migrated)
  - Or update existing tests to use AI SDK mocks
- `chartsmith-app/components/__tests__/ChatContainer-ai-sdk.test.tsx`:
  - Test form submission triggers `useChat` hook
  - Test `useChat` manages messages state (not Jotai atom)
  - Test streaming updates from `useChat`
  - **New behavior**: Messages update via AI SDK hooks, not Centrifugo
- `chartsmith-app/hooks/__tests__/useCentrifugo-no-chat.test.ts`:
  - Test Centrifugo still handles render updates
  - Test Centrifugo still handles plan updates
  - Test Centrifugo still handles workspace events
  - **Verify chat message handling is REMOVED**
- E2E test: `chartsmith-app/tests/chat-flow-ai-sdk.spec.ts`:
  - Test complete chat flow WITHOUT Centrifugo: submit message → AI SDK streaming → display message
  - Test multiple messages in conversation
  - **New behavior**: Chat works independently of Centrifugo

**User-Facing Behavior Tests (Should Pass Before AND After)**:
These tests verify the END RESULT is the same, even though implementation differs:
- E2E: User can submit a message and see a response
- E2E: User sees streaming text appear gradually
- E2E: User can submit multiple messages in sequence
- E2E: User sees role selection (developer/operator)
- E2E: Chat scrolling behavior works correctly (existing test)

**Tests That Should Pass After Implementation**:
- All NEW tests above pass
- User-facing behavior tests still pass
- Verify Centrifugo no longer receives `chatmessage-updated` events
- Verify Centrifugo still works for render/plan updates

**Verification**:
- Run: `npm run test:unit` (all unit tests pass)
- Run: `npm run test:e2e` (all E2E tests pass)
- Manual: Submit chat message, verify streaming works
- Manual: Verify Centrifugo still receives render/plan events
- Verify: No `chatmessage-updated` events needed from Centrifugo

**Success Criteria**:
- Chat UI uses AI SDK hooks
- Streaming works without Centrifugo for chat
- Other Centrifugo features still work
- All chat functionality preserved
- All tests pass before and after migration

---

## Phase 4: Integration, Cleanup, and Go Backend Refactoring
**Goal**: Complete migration, remove old implementations, and clarify Go backend's role

**Tasks**:
1. **Remove old chat implementations**:
   - Remove `pkg/llm/conversational.go` LLM streaming code (if fully replaced)
   - Remove Centrifugo chat message handling from `pkg/listener/`
   - Remove Centrifugo `chatmessage-updated` events
   - Keep Centrifugo for: render updates, plan updates, workspace events
2. **Refactor Go backend responsibilities**:
   - **Keep**: Tool execution, database operations, workspace management, file operations, render jobs
   - **Remove**: Direct LLM streaming (now handled by Next.js)
   - **New**: Context API endpoints (if added in Phase 1)
   - Update `ARCHITECTURE.md` to document new split
3. **Clean up dependencies**:
   - Remove unused Anthropic SDK imports from frontend
   - Consider removing Anthropic SDK from Go (if no longer used)
   - Remove custom streaming code
   - Update `package.json` and `go.mod`
4. **Update documentation**:
   - Update `ARCHITECTURE.md` with new architecture diagram
   - Update `chartsmith-app/ARCHITECTURE.md` with AI SDK usage
   - Document Next.js vs Go responsibilities
   - Add ADRs (Architecture Decision Records) for key decisions

**Testing Requirements**:

**Before Starting Phase 4** - Add these tests:
- Integration tests:
  - `chartsmith-app/tests/chat-integration.spec.ts`:
    - Test complete user journey: login → create workspace → chat → receive response
    - Test chat with file context (chart structure visible to LLM)
    - Test chat with plan history (previous plans visible to LLM)
    - Test tool calling in chat (e.g., `latest_subchart_version`)
    - Test error scenarios (network errors, API errors, timeout)
    - Test concurrent chats in same workspace
  - `pkg/workspace/integration_test.go`:
    - Test workspace context API returns correct data
    - Test tool execution API works correctly
    - Test database operations still work
    - Test render jobs still trigger correctly
- Regression tests:
  - Verify all existing E2E tests still pass
  - Verify all existing unit tests still pass
  - Verify non-chat Centrifugo features still work

**Tests That Should Pass After Implementation**:
- All integration tests pass
- All existing tests continue to pass
- **Remove obsolete tests**:
  - Delete tests that verify old Centrifugo chat flow
  - Delete tests for old Anthropic SDK implementation
  - Keep behavior tests, remove implementation tests
- **Update remaining tests**:
  - Update mocks to reflect new architecture
  - Remove references to removed code

**Code Verification** (automated checks):
```bash
# Verify no Anthropic SDK imports in frontend (excluding test mocks)
! grep -r "from '@anthropic-ai/sdk'" chartsmith-app/lib/ chartsmith-app/components/ chartsmith-app/hooks/ \
  --exclude='*.test.ts' --exclude='*.test.tsx' --exclude='__mocks__/*'

# Verify no LLM streaming in Go listener (should only handle non-chat events)
! grep -r "ConversationalChatMessage\|chatmessage-updated" pkg/listener/ \
  --exclude='*_test.go'

# Verify Centrifugo only handles non-chat events
grep -r "render-updated\|plan-updated\|workspace-event" chartsmith-app/hooks/useCentrifugo.ts

# Check for leftover TODOs related to migration
grep -r "TODO.*migrate\|TODO.*anthropic\|TODO.*vercel" . --exclude-dir=node_modules --exclude-dir=.git || echo "No migration TODOs found"
```

**Architecture Documentation Updates**:
1. Create `docs/architecture-decisions/001-vercel-ai-sdk-migration.md`:
   - Why we migrated to Vercel AI SDK
   - Why Next.js handles LLM streaming
   - Why Go backend keeps orchestration/tools/database
   - Trade-offs considered
2. Update `ARCHITECTURE.md`:
   - Add section: "Chat Architecture"
   - Diagram: User → Next.js (AI SDK) → LLM + Go (context/tools)
   - Document data flow for chat vs other features
3. Update `chartsmith-app/ARCHITECTURE.md`:
   - Document Vercel AI SDK usage
   - Document API route structure
   - Document Go backend integration points

**Verification**:
- Run: `npm run test` (all frontend tests)
- Run: `go test ./pkg/...` (all backend tests)
- Run: `npm run test:e2e` (all E2E tests)
- Manual: Full application smoke test
- Code review: Verify old implementations removed
- Documentation review: Verify all docs updated

**Success Criteria**:
- No direct Anthropic SDK usage in chat flow (unless also in Go for non-chat features)
- Centrifugo only used for non-chat features (render, plan, workspace events)
- All tests pass
- Documentation updated and accurate
- Old code removed (verified by tests and code review)
- Go backend's new role clearly documented

---

## Architecture: Next.js vs Go Responsibilities

### After Migration

**Next.js (with Vercel AI SDK)**:
- ✅ LLM chat streaming (AI SDK handles provider communication)
- ✅ Message history in UI state (`useChat` hook)
- ✅ Chat UI components and interactions
- ✅ Streaming text display
- ✅ System prompt construction
- ✅ Initial message context assembly
- ✅ Tool call coordination (orchestrates with Go)

**Go Backend**:
- ✅ **Tool execution** (when LLM requests tools via Next.js)
- ✅ **Database operations** (workspaces, charts, users, messages)
- ✅ **Workspace management** (create, update, delete, permissions)
- ✅ **File operations** (chart files, templates, values.yaml)
- ✅ **Render jobs** (Helm render, diff generation)
- ✅ **Plan management** (plan history, plan execution)
- ✅ **Context API** (provide chart structure, relevant files, plan history to Next.js)
- ✅ **Artifact Hub integration** (chart discovery, metadata)
- ✅ **Authentication** (session management, user validation)

**Centrifugo** (real-time WebSocket):
- ✅ Render job updates (progress, completion)
- ✅ Plan updates (plan execution status)
- ✅ Workspace events (collaborator actions)
- ❌ ~~Chat message streaming~~ (replaced by AI SDK streaming)

### Data Flow

**Chat Message Flow**:
```
User Input
  ↓
ChatContainer (useChat)
  ↓
POST /api/chat/stream (Next.js API route)
  ↓
├─→ GET /api/workspace/:id/context (Go) ─→ Chart structure, files, plan history
├─→ Anthropic API (via AI SDK) ─→ LLM response stream
└─→ POST /api/workspace/:id/tools/:name (Go) ─→ Tool execution (if needed)
  ↓
Stream response to browser (AI SDK)
  ↓
Display in ChatContainer
```

**Render Job Flow** (unchanged):
```
User triggers render
  ↓
POST /api/workspace/:id/render (Go)
  ↓
Go executes Helm render
  ↓
Centrifugo publishes render-updated events
  ↓
Frontend useCentrifugo hook updates UI
```

---

## Notes
- Each phase should be independently testable
- Can roll back to previous phase if issues arise
- Centrifugo remains for: render updates, plan updates, workspace events (non-chat)
- Go backend maintains its core responsibilities (tools, DB, workspace management)
- Next.js becomes the LLM interface layer (thin coordination, thick on streaming UI)

## Testing Philosophy

**Key Principles**:
1. **Test behavior, not implementation**: Tests should verify what the code does, not how it does it
2. **Distinguish refactoring from re-architecture**:
   - Refactoring (Phase 0): Same behavior → same tests pass before and after
   - New features (Phases 1-2): New code → new tests
   - Re-architecture (Phase 3): Different data flow → new tests for new behavior, keep user-facing behavior tests
3. **Mock external dependencies**: Use mocks for LLM APIs to keep tests fast and reliable
4. **Phase 0 enables testing**: Must refactor for testability BEFORE adding tests
5. **Integration tests for confidence**: Keep some integration tests with real APIs for final verification

**Test Types**:
- **Unit tests**: Test individual functions with mocked dependencies (fast, run in CI)
- **Integration tests**: Test component interactions with real external services (slower, run less frequently)
- **E2E tests**: Test full user flows with real (or test) backend
- **Regression tests**: Ensure existing functionality still works
- **Behavior tests**: Focus on user-facing outcomes, agnostic to implementation

**When Tests Fail After Changes**:
- **Pure refactor** (Phase 0): If test fails → fix code, tests shouldn't change
- **New feature** (Phases 1-2): If test fails → debug new code or update test
- **Re-architecture** (Phase 3): If test fails → update test for new implementation, or create new test for new behavior
- **If test reveals bug**: Fix bug before proceeding with migration
- **If test is brittle**: Rewrite test to focus on behavior, not implementation details

**Mocking Strategy** (from Phase 0):
- All unit tests use mocked LLM clients
- Mock should return canned responses that cover:
  - Normal streaming responses
  - Tool calls
  - Errors (API errors, network errors, timeouts)
  - Edge cases (empty responses, very long responses)
- Integration tests use real APIs but are run less frequently
- Use environment variable `TEST_MODE=unit|integration` to toggle

**Coverage Goals** (Pragmatic Approach):
- **Critical paths** (chat flow, streaming, tool calling): **70%+ coverage**
- **API routes and key functions**: **60%+ coverage**
- **Supporting functions** (parsers, utils): **50%+ coverage**
- **Integration tests**: Cover major user journeys, not every edge case
- **E2E tests**: Cover happy paths and critical error scenarios
- Focus on testing **behavior** over achieving arbitrary coverage numbers

**Test Database Strategy**:
- Use separate test database (`chartsmith_test`)
- Each test runs in a transaction that rolls back (no persistent state)
- Use fixtures for common test data (workspaces, users, chat messages)
- Mock Centrifugo in unit tests, use real Centrifugo in E2E tests (optional)

**Test File Organization**:
- **Frontend**: `__tests__` directory next to source files
  - Example: `components/ChatContainer.tsx` → `components/__tests__/ChatContainer.test.tsx`
- **Backend**: `*_test.go` files next to source files
  - Example: `pkg/api/workspace_context.go` → `pkg/api/workspace_context_test.go`
- **Test helpers**: Separate `testing/` directory
  - Example: `pkg/llm/testing/mock_client.go`
- **E2E tests**: `chartsmith-app/tests/` directory
  - Example: `chartsmith-app/tests/chat-flow.spec.ts`

**Migration-Specific Testing Notes**:
- **Phase 0**: Add tests for existing behavior (with mocks)
- **Phase 1**: Add tests for new API route (isolated from frontend)
- **Phase 2**: Add tests for POC component (validate integration)
- **Phase 3**: Update tests for new frontend implementation (remove Centrifugo mocks for chat)
- **Phase 4**: Add integration tests, remove obsolete tests, update documentation

**Pragmatic Trade-offs**:
- Don't let perfect be the enemy of good - some tests > no tests
- Focus on high-value tests (critical user flows) first
- Add more granular tests as bugs are discovered
- Integration tests provide confidence even with lower unit test coverage
- Real-world usage is the ultimate test - deploy to staging early and often

