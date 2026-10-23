# Changelog

## 0.1.0 (unreleased)

First version: `featherTest({ createApp, db?, mintSession?, runner? })` with the fixtures `app`, `handler`, `baseUrl`, `session`, `request`, `api`, `db`, `sql`, `testDb`, `dbEngine`, `logInAs` and `auth`, on feather-testing-core 0.7.0-beta.1 and feather-testing-postgres 0.2.0.

### Decisions

- **`logInAs` and running steps: refuse, don't cooperate.** A login changes the cookies of every client at once, so a request still in flight across it could set the previous user's cookie afterwards. Waiting for running chains (and holding chains started during a login) was tried and dropped: a held chain shared the session's step queue with later steps, so an awaited chain could resolve before its own steps ran. The rule is now: await your steps before `logInAs`, and await `logInAs` before your next steps. `logInAs` refuses while a `session` or `request` chain is running, and a chain started during a login refuses itself. Both fail loudly and change nothing.
- **`logInAs` signs in the test's own clients and returns per-user ones.** `session`, `request` and `api` switch together, and `{ cookies, request, api }` are returned for tests with several users.
- **Logins are two-phase and serialised.** Cookies are validated first. The browser step snapshots the context, clears what the login replaces, adds the new cookies and restores the snapshot if the add fails. Only then does the state change and `request` take the cookies (`setCookies`). Overlapping logins run in call order, so the last one started wins.
- **TypeScript source is shipped**, as feather-testing-postgres does.
