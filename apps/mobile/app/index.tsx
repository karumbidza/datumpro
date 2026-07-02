import { View, ActivityIndicator } from 'react-native';

/** Splash while the AuthGate decides where to send us (sign-in or the app). */
export default function Index() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator />
    </View>
  );
}
