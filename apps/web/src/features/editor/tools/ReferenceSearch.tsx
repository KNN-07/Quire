import { Field } from "../../../ui";
import type { ReferenceFilter } from "./library-metadata";

const filters: readonly ReferenceFilter[] = ["all", "key", "author", "title", "journal", "year", "date"];
export function ReferenceSearch(props: {
  readonly label: string; readonly query: string; readonly filter: ReferenceFilter;
  readonly onQuery: (query: string) => void; readonly onFilter: (filter: ReferenceFilter) => void;
}) {
  return <div className="library-search">
    <Field label={props.label} placeholder="Search literal bibliography metadata" value={props.query}
      onChange={event => props.onQuery(event.target.value)} />
    <label>{props.label} field<select aria-label={`${props.label} field`} value={props.filter}
      onChange={event => {
        const filter = filters.find(value => value === event.target.value);
        if (filter) props.onFilter(filter);
      }}>
      <option value="all">All fields</option><option value="key">Citation key</option>
      <option value="author">Author</option><option value="title">Title</option>
      <option value="journal">Journal</option><option value="year">Year</option><option value="date">Date</option>
    </select></label>
  </div>;
}
