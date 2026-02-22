import MdiIcon, { type IconProps } from '@mdi/react';

export type Props = IconProps & {
  icon?: string;
};

export function resolveIconPath(props: Props): string {
  return String(props.path || props.icon || '').trim();
}

export default function Icon(props: Props) {
  const resolvedPath = resolveIconPath(props);
  if (!resolvedPath) {
    return null;
  }
  return <MdiIcon {...props} path={resolvedPath} />;
}
