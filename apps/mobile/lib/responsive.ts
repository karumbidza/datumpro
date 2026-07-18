import { useWindowDimensions } from 'react-native';
import { maxWidth } from './theme';

/** Layout facts derived from the live window size — recomputes on rotation and
 *  on tablets. `isWide` is the tablet / phone-landscape breakpoint.
 *
 *  - Phones (portrait): one centered, readable column capped at maxWidth.
 *  - Wide (tablet / landscape): a wider column so the extra space is usable, and
 *    list screens switch to two columns.
 */
export function useResponsive() {
  const { width, height } = useWindowDimensions();
  const isWide = width >= 700;
  const columns = isWide ? 2 : 1;
  const contentMaxWidth = isWide ? 960 : maxWidth;
  return { width, height, isWide, columns, contentMaxWidth };
}
