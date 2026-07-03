"use client";

import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { apiFetch } from "@/lib/client-api";
import { POST_CATEGORY_LABELS } from "@/lib/community-labels";
import { useToast } from "@/components/ui/toast";
import { Button, LinkButton } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Input, Textarea, Select, Label, FieldError } from "@/components/ui/input";
import { IconPlus } from "@/components/ui/icons";

export function NewPostButton({ isLoggedIn }: { isLoggedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState("PULLS");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const router = useRouter();

  if (!isLoggedIn) {
    return (
      <LinkButton href="/logga-in?callbackUrl=/community" variant="primary">
        Logga in för att posta
      </LinkButton>
    );
  }

  async function submit() {
    if (title.trim().length < 3) {
      setError("Titeln måste vara minst 3 tecken.");
      return;
    }
    if (!content.trim()) {
      setError("Skriv något innehåll.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const post = await apiFetch<{ id: string }>("/api/community/posts", {
        method: "POST",
        body: { title: title.trim(), content: content.trim(), category },
      });
      toast({ title: "Inlägget har publicerats", variant: "success" });
      setOpen(false);
      setTitle("");
      setContent("");
      router.push(`/community/${post.id}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Något gick fel.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <IconPlus size={16} />
        Nytt inlägg
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Nytt inlägg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Avbryt
            </Button>
            <Button onClick={() => void submit()} loading={saving}>
              Publicera
            </Button>
          </>
        }
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div>
            <Label htmlFor="postTitle">Titel</Label>
            <Input
              id="postTitle"
              placeholder="t.ex. Drog ett Moonbreon i min första box!"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
            />
          </div>
          <div>
            <Label htmlFor="postCategory">Kategori</Label>
            <Select
              id="postCategory"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {Object.entries(POST_CATEGORY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="postContent">Innehåll</Label>
            <Textarea
              id="postContent"
              placeholder="Dela din pull, fråga eller marknadsspaning…"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              maxLength={10000}
              rows={6}
            />
          </div>
          <FieldError message={error} />
        </form>
      </Modal>
    </>
  );
}
