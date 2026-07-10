# Invite Friend — API contract

Faithful rebuild of the legacy "Invite Friend to join Who I Follow" modal
(`whoifollow-customerfrontend/src/components/Home/InviteFriendsModal.vue`).

Invite a person to the **platform** (not a team). Delivers an Email
(`mail.invite-email-template` Mailable) and/or SMS (Twilio, `+1` numbers only),
records an `Invite` row (`invite_type = platform_signup`), and — when the target
already has an account — returns their friend-connection status instead.

## Endpoint

```
POST /v2/friends/invite        (auth required)
```

Backend: `App\Http\Controllers\Api\V2\FriendInviteController@invite`, a thin
`/v2` wrapper over the still-live legacy `Api\InvitesController@sendSocialInvite`
(`POST /invite/sendSocialInvite`). No schema change — the reschema'd `invites`
table + `Invite` model handle the write via legacy column aliases.

## Request

```jsonc
{
  "countryCode": "+1",          // dial code for `number`; default "+1"
  "number": "5551234567",       // digits only (no formatting); optional
  "email": "friend@example.com" // optional
}
```

At least one of `number` / `email` must be present (the modal enforces this;
the endpoint also validates → `422`).

## Response — standard envelope

Every **expected** outcome returns `200` with an `outcome` discriminator in
`data` (the shared frontend client only reads a top-level `message` on non-2xx,
so business messages are carried inside `data` where the adapter can read them).

```jsonc
{
  "responseStatus": { "message": "…", "statusCode": 200, "text": "OK" },
  "data": {
    "outcome": "sent" | "already_registered" | "blocked",
    "message": "Invitation has been sent successfully.",

    // only when outcome === "already_registered":
    "friendStatus": 0,          // 0 = not friends, 1 = friends, 3 = request pending
    "user": {
      "id": "1234",
      "name": "Ben David",
      "avatarUrl": "https://cdn…/…",   // raw path; frontend resolves via CDN helper
      "userLink": "ben-david"
    }
  }
}
```

- `sent` — invitation delivered (email and/or SMS). Modal shows a success toast.
- `already_registered` — target has an account; modal shows an inline card with
  `user` + a label derived from `friendStatus`.
- `blocked` — soft rejection (already invited, can't invite yourself, …);
  `message` is display-ready and shown inline.

Genuine transport/server errors (`5xx`) throw in the client and surface a toast.

## Frontend wiring

- `src/api/friends.ts` → `inviteFriend(payload)` → `InviteFriendResult` (unwraps
  the envelope, maps `user` via `buildUserAvatarUrl`).
- `src/components/InviteFriendModal.vue` — SlideModal rebuild, mounted once in
  `App.vue`, opened globally via `src/invite-modal-center.ts`.
- Trigger: **Invite** button in `MemberTopBar.vue` right cluster.
