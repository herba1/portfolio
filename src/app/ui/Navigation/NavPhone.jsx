
import { Phone } from "lucide-react";
export default function NavPhone({ phone = "559-XXX-XXXX" }) {
  return (
    <div className="flex items-center font-extrabold underline">
      <Phone size={16} className="mr-1"></Phone>
      <a href={`tel:${phone}`}>{phone}</a>
    </div>
  );
}