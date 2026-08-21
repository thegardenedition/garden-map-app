export default function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8 py-10 text-center">
      <p className="tp-body font-bold text-[#3A3A55]">{title}</p>
      <p className="tp-caption mt-1 font-normal text-[#9AA0C4]">{body}</p>
    </div>
  );
}
