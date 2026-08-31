import InlineEditableTableExperience from "./InlineEditableTableExperience";

export const metadata = {
  title: "Inline-editable table",
  description: "A data table where cells edit in place, Tab and arrows move focus, edits show a pending state then commit, with an undo toast that counts down.",
};

export default function InlineEditableTablePage() {
  return <InlineEditableTableExperience />;
}
