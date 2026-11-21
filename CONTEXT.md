# Relay

Relay is an AI agent platform for agencies: each company runs customer-facing agents and internal operator agents, and people step in where an agent needs them.

## Language

### People

**Client**:
The agency's customer company, such as Acme GmbH: the company in Relay whose agents the agency runs.
_Avoid_: Customer (that is the client's own customer, who talks to a customer agent)

**Owner**:
The agency person who owns a company in Relay and alone manages its members and customer resources.

**Member**:
An agency person invited to a company to do operator work, limited by page permissions and, per operator agent, by edit and approve rights.
_Avoid_: Operator (as a role name), teammate

**Agent creator**:
The person who created an operator agent. Always holds edit and approve rights on it.
_Avoid_: Owner, agent owner (Owner is the company owner)

**Agent user**:
A member given rights on one operator agent: edit, approve, or both.
_Avoid_: Editor (as the only kind), collaborator

**Approver**:
Anyone who may approve checkpoints on a given operator agent: the owner, its agent creator, or an agent user with approve rights.
_Avoid_: Reviewer, admin

**Client user**:
A person at the client who signs in to the client portal. Holds exactly one company membership and never sees operator work.
_Avoid_: Client member, client staff (as a role name)

**Client portal**:
The reduced app a client user sees: Reports and Live, with no Inbox and no Settings. Owners and members can open a read-only preview of it.
_Avoid_: Client view, client dashboard

### Human handoff

**Human handoff**:
An agent passing a live customer conversation to a person, who answers through a quick link or takes the conversation over.
_Avoid_: Handoff (unqualified), escalation (as a noun for the mechanism)

**Handoff request**:
One instance of a human handoff: the question the agent could not answer, waiting for a person until it is answered, taken over or expired.

**Quick link**:
The single-use, expiring link a person receives to answer a handoff request without logging in.
_Avoid_: Magic link, token link

**Takeover**:
A person replacing the agent in a conversation until they hand it back.

**Handoff mode**:
How a customer agent reaches a person, set per agent: Quick answer, Takeover or Team chat.
_Avoid_: Full agent mode, take-off, semi-takeover

**Quick answer**:
The handoff mode where the primary recipient answers once through a quick link, as themselves or phrased by the agent, and the agent carries on.

**Team chat**:
The handoff mode where the agent asks a WhatsApp group; the first reply quoting the question is the answer, which the agent rephrases to the customer.

**Primary recipient**:
The one person a customer agent's handoff requests go to by quick link; the Inbox is always the fallback.

**Waiting for you**:
Handoff requests that expired unanswered and are back in the Inbox for anyone on the team to answer as the company.

**Escalated**:
Conversations that have had a handoff request, in any state.

**Dev handoff**:
The design-to-code reference boards in Figma (page 10): token table, redlines, Code Connect map. Unrelated to human handoff.
_Avoid_: Handoff (unqualified)

### Surfaces

**Widget**:
The chat a customer agent shows on a client's own website, used by the client's customers. Relay's own people never chat through it.
_Avoid_: Chat widget (for anything operator-facing)

**Home tile**:
One configurable block on Home, such as Needs you or Lead engine, with a visibility setting that decides who sees it.
_Avoid_: Widget, card (for Home blocks)

### Operator work

**Session**:
An operator working with one operator agent on a brief: a conversation the operator steers, beside a work pane showing what the agent produces.
_Avoid_: Panel chat, operator chat, master chat

**Schedule**:
A recurring operator job that runs an operator agent on a timetable. Stored as a cron job.
_Avoid_: Cron, cron job (in user-facing language)

**Package**:
A ready-made bundle of operator agents, workflows and schedules from Relay's fixed catalog (Lead engine, Social media, Insights). A company installs each package at most once, and only the owner installs.
_Avoid_: Template, preset, Revenue package (replaced by Lead engine). Not a pnpm workspace package.

**Package install**:
The record that a company installed a package, and when. Installed agents, workflows and schedules then live on as the company's own and can be edited.

### Workflows

**Workflow**:
A named, ordered grouping of a company's operator agents into stages, shown as a lane, with an optional weekly target. It describes how work flows; it does not run or trigger anything. Comes from a package.
_Avoid_: Pipeline, lane (the lane is its picture), orchestration

**Stage**:
One step of a workflow, run by one operator agent. An agent may run several stages, in one workflow or several.

**Outcome stage**:
A stage with no agent that counts what the workflow delivered, such as Delivered to client.

**Inbound**:
Leads that customer agents create from their conversations and feed into a stage of a workflow. Customer agents are never stages.

**Weekly target**:
The number a workflow aims to reach each week, such as 10 qualified leads delivered.
_Avoid_: Goal (unqualified), KPI

### Leads

**Fit score**:
How well a lead matches the client's ideal customer, from 0 to 100, set by the agent that scores it, with short fit reasons.
_Avoid_: Lead score (unqualified), rating

**Qualified lead**:
A lead with a fit score of 70 or more, or a borderline lead a person accepted (its fit score stays as scored). Qualifying happens before outreach; a reply comes later and does not make a lead qualified.
_Avoid_: Qualified (for a lead that replied; that lead is interested)
This is also the billing basis for the pilot client's contract: the invoice and CSV count qualified leads. There is no separate billable lead. The pre-redesign meaning (5 fields + kod, from #18) is retired; migrated leads that were qualified stay qualified whatever their x10 score lands at.

**Borderline lead**:
A lead with a fit score from 50 to 69, held for a person to accept or reject. It never blocks a run.

**Rejected lead**:
A lead with a fit score under 50, kept with one reject reason.

**Intake**:
The ordered list of fields a customer agent collects from a prospect for a workflow, such as name, company, need and budget. Customer agents gather; they never score.

**Intake complete**:
Every required intake field is filled, so the lead is ready for the qualify agent to score. A lead left incomplete for a day is scored anyway.
_Avoid_: Gathered (that is outbound accounts the research agent found)

**Lead quality score**:
The average fit score of the leads delivered to the client in a period.
_Avoid_: Quality score (unqualified)

**Lead event**:
One recorded change of a lead's status, made by one agent or one person at one time. Credit for leads per agent and every lead count come from lead events.
_Avoid_: Lead history, activity

### Checkpoints

**Checkpoint**:
An action an operator agent wants to take that leaves Relay (send mail, publish a post, reply to a review, deliver leads to the client), held in a card until a person with approve rights approves it. One card per action; a revision is a new card.
_Avoid_: Pending action, approval (as a noun for the card), HITL

**Changes requested**:
A checkpoint sent back to the agent with quoted direction; it stays as history once the agent posts the revised card.
_Avoid_: Rejected

**Discarded**:
A checkpoint dropped by a person; nothing leaves Relay.
_Avoid_: Rejected, cancelled

**Stale**:
A checkpoint whose draft was edited after the card was posted; it cannot be approved until the agent refreshes it into a new card.

**Failed**:
An approved checkpoint whose action did not go through; it can be retried, sent back for changes or discarded.

**Agent question**:
A question an operator agent asks a person mid-task, answered in text. Not a checkpoint: nothing is approved and nothing leaves Relay.
_Avoid_: Handoff request (that is customer-agent work)

**Needs you**:
Everything waiting on a person in operator work: open, stale and failed checkpoints, open agent questions and failed schedule runs. Handoff requests are not Needs you; they live in the Inbox.

**Impact tier**:
The rank of a Needs you item by what it holds up: a stopped lead workflow first, then lead checkpoints and questions, then everything else. Within a tier the oldest item comes first.
_Avoid_: Priority, urgency

### Reports

**Report snapshot**:
The frozen numbers of one closed day, week or month for a company, with an optional written summary from Insights. It never changes after the period closes.
_Avoid_: Report run, weekly report (for the daily or monthly one)

**Live feed event**:
One thing a client sees happen on the Live page: an inbound lead qualified, leads delivered, a handoff sent, a conversation started.
_Avoid_: Activity, notification

### Marketing

**Plan**:
A pricing tier on the public site: Free, Pro or Enterprise. It states intended limits during the closed beta; nothing in the product enforces it.
_Avoid_: Subscription, tier (in copy)

**Access request**:
A prospect's ask to join the closed beta, sent from a Request access or Contact sales button, naming the plan they looked at.
_Avoid_: Lead (that is the client's prospect), signup, waitlist entry
