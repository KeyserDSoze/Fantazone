# Fantazone app

The application will be migrated from `src/Fantasoccer.Applications/fantasoccer` in the Fantasoccer repository rather than redesigned from scratch.

Initial dependency baseline follows the currently compatible stack used by Fantasoccer: Expo SDK 57, React 19.2, React Native 0.86 and Tamagui 2.7.x. UI screens/components should be ported with minimal visual changes first; service integrations are then replaced behind adapters.

Target module boundaries:

```text
app/
  components/
  screens/
  navigation/
  providers/
  hooks/
  services/        # application orchestration only
  platform/github/ # @fantazone/github adapter
  realtime/        # WebRTC auction transport
```

Do not call the old Fantasoccer API or SignalR hub from migrated code.
