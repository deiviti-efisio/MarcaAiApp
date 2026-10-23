import { requireNativeModule } from "expo-modules-core";

type AgendaWidgetNative = {
  saveSnapshot: (json: string) => void;
};

export default requireNativeModule<AgendaWidgetNative>("AgendaWidget");
