interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: FilePickerAcceptedType[];
  excludeAcceptAllOption?: boolean;
  id?: string;
  startIn?: FileSystemHandle | WellKnownDirectory | string;
}

interface OpenFilePickerOptions {
  multiple?: boolean;
  types?: FilePickerAcceptedType[];
  excludeAcceptAllOption?: boolean;
  id?: string;
  startIn?: FileSystemHandle | WellKnownDirectory | string;
}

interface FilePickerAcceptedType {
  description?: string;
  accept: Record<string, string[]>;
}

interface Window {
  showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;
  showOpenFilePicker?: (options?: OpenFilePickerOptions) => Promise<FileSystemFileHandle[]>;
}
