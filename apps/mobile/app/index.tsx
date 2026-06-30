import { Text, View } from 'react-native';
import { CURRENCY } from '@datumpro/shared/domain';

/** Placeholder field-app entry. The offline capture flow (site reports, photos,
 *  GPS) + PowerSync ↔ Supabase sync land in the mobile slice. Importing from
 *  @datumpro/shared here confirms the workspace wiring is correct. */
export default function Index() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 }}>
      <Text style={{ fontSize: 22, fontWeight: '600' }}>DatumPro Field</Text>
      <Text style={{ color: '#71717a' }}>Offline site monitoring · {CURRENCY}</Text>
    </View>
  );
}
