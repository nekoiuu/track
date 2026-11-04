"use client";

import { useActionState, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CheckIcon, ChevronsUpDownIcon, PlayIcon, PlusIcon, TruckIcon } from "lucide-react";
import { cn } from "cn";
import { startPickup, type FormState } from "@/app/actions/pickups";
import type { VehicleOption } from "@/app/actions/vehicles";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Field, Pill } from "./kit";
import { useActionToast } from "./motion";
import { VehicleDialog } from "./vehicle-dialog";

const RECENT = 6;

/**
 * เริ่มงานรถเข้ารับ — เลือกทะเบียน (ไม่ต้องพิมพ์ซ้ำ) แล้วกดเริ่ม
 * เวลาเริ่มงาน = ตอนกดปุ่ม ไม่ต้องกรอก
 */
export function StartPickupForm({ vehicles: initial, carriers }: { vehicles: VehicleOption[]; carriers: string[] }) {
  const [vehicles, setVehicles] = useState(initial);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [comboOpen, setComboOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [addPlate, setAddPlate] = useState("");

  const [state, action, pending] = useActionState<FormState, FormData>(startPickup, undefined);
  useActionToast(state);


  const selected = vehicles.find((v) => v.id === selectedId) ?? null;
  const recent = vehicles.slice(0, RECENT);
  const exact = useMemo(
    () => vehicles.some((v) => v.plate.replace(/\s/g, "") === query.replace(/\s/g, "")),
    [vehicles, query],
  );

  const select = (id: string) => {
    setSelectedId(id);
    setComboOpen(false);
    setQuery("");
  };

  const openAdd = (plate = "") => {
    setAddPlate(plate);
    setComboOpen(false);
    setAddOpen(true);
  };

  return (
    <form
      action={action}
      className="grid gap-8"
    >
      <input type="hidden" name="vehicleId" value={selectedId ?? ""} />

      {recent.length > 0 && (
        <div className="grid gap-3">
          <p className="text-sm font-medium">รถที่มาบ่อย</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {recent.map((v, i) => (
              <motion.button
                key={v.id}
                type="button"
                onClick={() => select(v.id)}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                whileTap={{ scale: 0.97 }}
                className={cn(
                  "relative flex min-h-20 flex-col items-start justify-center gap-1 rounded-lg bg-card px-4 py-3 text-left shadow-card transition-shadow hover:shadow-float",
                  selectedId === v.id && "ring-2 ring-ink",
                )}
              >
                <span className="pr-5 text-lg leading-tight font-semibold tracking-[-0.4px]">{v.plate}</span>
                <span className="flex flex-wrap items-center gap-1.5 text-xs text-mute">
                  {v.carrier ?? "—"}
                  {v.busy && (
                    <Pill tone="amber">
                      <span className="live-dot size-1.5 rounded-full bg-warning" />
                      มีงานค้าง
                    </Pill>
                  )}
                </span>
                <AnimatePresence>
                  {selectedId === v.id && (
                    <motion.span
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      exit={{ scale: 0 }}
                      className="absolute right-2 bottom-2 grid size-5 place-items-center rounded-full bg-ink text-white"
                    >
                      <CheckIcon className="size-3" />
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.button>
            ))}
          </div>
        </div>
      )}

      <Field label={recent.length ? "หรือค้นหาทะเบียน" : "ทะเบียนรถ"}>
        <div className="flex gap-2">
          <Popover open={comboOpen} onOpenChange={setComboOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                role="combobox"
                aria-expanded={comboOpen}
                className="h-12 flex-1 justify-between bg-card px-3 text-base font-normal"
              >
                {selected ? (
                  <span className="flex items-center gap-2">
                    <TruckIcon className="text-mute" />
                    <span className="font-medium">{selected.plate}</span>
                    <span className="text-sm text-mute">{selected.carrier}</span>
                  </span>
                ) : (
                  <span className="text-mute">เลือกทะเบียนรถ…</span>
                )}
                <ChevronsUpDownIcon className="text-mute" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
              <Command>
                <CommandInput value={query} onValueChange={setQuery} placeholder="พิมพ์ทะเบียนหรือขนส่ง…" className="text-base" />
                <CommandList>
                  <CommandEmpty>ไม่พบทะเบียนนี้</CommandEmpty>
                  <CommandGroup>
                    {vehicles.map((v) => (
                      <CommandItem key={v.id} value={`${v.plate} ${v.carrier ?? ""} ${v.driverName ?? ""}`} onSelect={() => select(v.id)}>
                        <CheckIcon className={cn(selectedId === v.id ? "opacity-100" : "opacity-0")} />
                        <span className="font-medium">{v.plate}</span>
                        <span className="text-xs text-mute">{v.carrier}</span>
                        {v.busy && (
                          <span className="ml-auto">
                            <Pill tone="amber">มีงานค้าง</Pill>
                          </span>
                        )}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                  {query.trim() && !exact && (
                    <CommandGroup forceMount>
                      <CommandItem forceMount value={`__add__${query}`} onSelect={() => openAdd(query.trim())}>
                        <PlusIcon />
                        เพิ่มทะเบียน “{query.trim()}”
                      </CommandItem>
                    </CommandGroup>
                  )}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          <Button type="button" variant="outline" size="icon-lg" className="size-12 bg-card" onClick={() => openAdd()} aria-label="เพิ่มรถใหม่">
            <PlusIcon />
          </Button>
        </div>
      </Field>

      <VehicleDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        draft={{ plate: addPlate }}
        carriers={carriers}
        onSaved={(v) => {
          setVehicles((list) => [v, ...list.filter((x) => x.id !== v.id)]);
          setSelectedId(v.id);
        }}
      />

      <AnimatePresence initial={false}>
        {selected && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="grid gap-4 pb-1">
              <Field label="ขนส่ง" htmlFor="carrier">
                <Input key={selected.id} id="carrier" name="carrier" list="carriers" defaultValue={selected.carrier ?? ""} />
                <datalist id="carriers">
                  {carriers.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </Field>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-col gap-2">
        <Button type="submit" size="lg" disabled={!selected || pending} className="h-14 text-base">
          <PlayIcon />
          {pending ? "กำลังเริ่มงาน…" : selected ? `เริ่มงาน ${selected.plate}` : "เลือกรถก่อนเริ่มงาน"}
        </Button>
      </div>
    </form>
  );
}
