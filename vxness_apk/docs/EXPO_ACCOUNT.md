# Expo account / EAS project

This app had no Expo project of its own. The `owner`, EAS project id and
updates URL that used to sit in `app.json` belonged to the account this build
was white-labelled from — leaving them in would have sent this app's OTA
updates and its push tokens to somebody else's project.

`eas init`, run on the Vxness Expo account, writes `owner`,
`extra.eas.projectId` and `updates.url` back into `app.json`. The push token in
`src/services/notifications/pushNotifications.js` starts resolving from
expoConfig once that is done, instead of returning null.

This lived in `app.json` as a `_note_expo_account` key, which is not a valid
Expo config property — `expo-doctor` failed schema validation on it and an EAS
build can refuse the config outright. It belongs in a doc, not the manifest.
