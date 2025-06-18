declare module 'react-dom/client' {
  import { ReactElement } from 'react';
  
  export interface Root {
    render(children: ReactElement): void;
    unmount(): void;
  }
  
  export function createRoot(container: Element | DocumentFragment): Root;
  export function hydrateRoot(
    container: Element | Document,
    initialChildren: ReactElement
  ): Root;
}