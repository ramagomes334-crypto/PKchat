# PK Chat — Security Specification & Dirty Dozen TDD

## 1. Data Invariants
1. **Strict Ownership of Private PII**: A user's email, phone number, OTP verification status, and password hash live exclusively in `users/{uid}/private/info` and are readable/writable only by `request.auth.uid == uid`.
2. **Verified Authentication Gate**: All writes require `request.auth != null && request.auth.token.email_verified == true`.
3. **Unique Username Binding**: Claiming `usernames/{username}` requires `incoming().uid == request.auth.uid` and strictly matches `^[a-z0-9_]{3,30}$`.
4. **Conversation Membership Gate (Master Gate)**: Messages and member settings inside `conversations/{convId}` are accessible only if `request.auth.uid` is present in the parent conversation's `memberUids`.
5. **Sender Integrity**: Messages created in `conversations/{convId}/messages/{msgId}` must have `incoming().senderUid == request.auth.uid` and `incoming().createdAt == request.time`.
6. **Group Admin Privileges**: Modifying group metadata (`title`, `description`, `photoURL`, `onlyAdminsCanSend`, `onlyAdminsCanEditInfo`, `adminUids`) is restricted to UIDs in `existing().adminUids` (unless `onlyAdminsCanEditInfo == false` for title/description/photo).
7. **Immutable Audit Fields**: `createdAt`, `createdBy`, `senderUid`, `authorUid`, and `callerUid` cannot be changed after creation.
8. **Bounded Arrays & String Limits**: All string fields enforce `.size() <= MAX` and all list fields enforce `.size() <= 50` to prevent Denial-of-Wallet attacks.
9. **Terminal Call State**: Once a call record reaches `'ended'`, `'missed'`, or `'rejected'`, status transitions back to `'ringing'` or `'active'` are blocked.
10. **Status Privacy & 24h TTL**: Status posts validate `expiresAt` and author integrity; `status_views` only allows the viewer to create their own receipt (`viewerUid == request.auth.uid`).

## 2. The "Dirty Dozen" Payloads (Expected: PERMISSION_DENIED)
1. **Unauthenticated Read**: `GET /users/userA` with `auth = null`.
2. **PII Leak Attempt**: `GET /users/userA/private/info` signed in as `userB`.
3. **Identity Spoofing in Message**: `CREATE /conversations/c1/messages/m1` as `userB` with `senderUid: "userA"`.
4. **Shadow Field Injection**: `CREATE /users/userA` with extra field `isAdmin: true`.
5. **Non-Member Message Injection**: `CREATE /conversations/c1/messages/m2` as `userC` who is not in `c1.memberUids`.
6. **ID Poisoning**: `CREATE /conversations/invalid$id!@#` violating `^[a-zA-Z0-9_\-]+$`.
7. **Timestamp Forgery**: `CREATE /conversations/c1/messages/m3` with client-backdated `createdAt`.
8. **Privilege Escalation in Group**: Non-admin `userB` updating `adminUids` on group `c1`.
9. **Username Hijack**: `CREATE /usernames/alice` as `userB` with `uid: "userB"` when already owned, or `uid: "userA"`.
10. **Other User's Contact Tampering**: `CREATE /users/userA/contacts/c1` signed in as `userB`.
11. **Message Content Tampering by Non-Sender**: `UPDATE /conversations/c1/messages/m1` (`text`) signed in as `userB` when `senderUid == "userA"`.
12. **Terminal Call Re-open**: `UPDATE /calls/call1` changing `status` from `'ended'` back to `'active'`.
