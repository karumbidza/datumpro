import { View } from 'react-native';
import { BrandLoader } from '../components/brand-loader';

/** Splash while the AuthGate decides where to send us (sign-in or the app). */
export default function Index() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <BrandLoader />
    </View>
  );
}
