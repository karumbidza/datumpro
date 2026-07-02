/** Expo inlines EXPO_PUBLIC_* into process.env at build; declare the shape so
 *  TypeScript is happy without pulling in full @types/node. */
declare const process: {
  env: Record<string, string | undefined>;
};
