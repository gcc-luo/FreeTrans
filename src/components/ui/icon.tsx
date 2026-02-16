import MdiIcon, { type IconProps } from '@mdi/react';

export type Props = IconProps;

export default function Icon(props: Props) {
  return <MdiIcon {...props} />;
}
